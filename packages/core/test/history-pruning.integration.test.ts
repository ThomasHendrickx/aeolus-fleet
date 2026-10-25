import { ANSWER_CONTENT_TYPE, createIdGenerator, idSchema, QUESTION_CONTENT_TYPE, type DeliveryState, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaFleetRepository } from '../src/adapters/prisma/registry.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import { createPruneHistory } from '../src/domain/shared/prune-history.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { agentCaller, modelOf, operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';

// Pruning finished history on a real Postgres (decision 0066; the retention
// design, R2, R6, R11, R12 and R14): what is still on its way, or still
// waiting on a person, survives a pass at any age; what is finished past the
// retention goes with its deliveries and events and takes its bytes off
// storage; and a pass racing a send, an acknowledgement, a second server or a
// fleet's delete, or failing mid-batch, loses nothing it should keep.

const newId = createIdGenerator();
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const RETENTION_DAYS = 30;

let core: PostgresCore;
let argo: ShipCaller;
let scout: Crew;
let planner: Crew;

async function crewed(ship: { name: string; type: string }): Promise<Crew> {
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
  scout = await crewed({ name: 'scout', type: 'reviewer' });
  planner = await crewed({ name: 'planner', type: 'planner' });
  await core.prisma.$executeRaw`UPDATE fleets SET retention_set = true, retention_days = ${RETENTION_DAYS} WHERE id = ${argo.fleetId}`;
});

afterEach(async () => {
  await core.close();
});

async function sendTo(shipId: ShipId, options: { from?: Crew; payload?: string; contentType?: string; inReplyTo?: MessageId } = {}): Promise<MessageId> {
  core.clock.advance(1_000);
  const from = options.from ?? scout;
  return unwrap(
    await core.useCases.sendMessage(from, {
      ...modelOf(from),
      selector: { kind: 'ship', shipId },
      payload: options.payload ?? 'Review pr-1080',
      contentType: options.contentType ?? 'text/plain',
      idempotencyKey: `key-${newId('message')}`,
      ...(options.inReplyTo === undefined ? {} : { inReplyTo: options.inReplyTo }),
    }),
  ).messageId;
}

async function acknowledged(crew: Crew, messageId: MessageId): Promise<void> {
  core.clock.advance(1_000);
  unwrap(await core.useCases.receiveDeliveries(crew, { max: 10 }));
  const { id } = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
  unwrap(await core.useCases.acknowledgeDelivery(crew, { deliveryId: idSchema('delivery').parse(id) }));
}

/** A message the scout sends the planner, which the planner receives and acknowledges: finished. */
async function aFinishedMessage(payload?: string): Promise<MessageId> {
  const messageId = await sendTo(planner.shipId, payload === undefined ? {} : { payload });
  await acknowledged(planner, messageId);
  return messageId;
}

/** The 30 second pass, past the retention: the snapshot close, then the pruning pass. */
async function passAfter(ms: number): Promise<void> {
  core.clock.advance(ms);
  await core.useCases.closeHealthSnapshots();
  await core.useCases.pruneHistory();
}

async function isKept(messageId: MessageId): Promise<boolean> {
  return (await core.prisma.message.count({ where: { id: messageId } })) === 1;
}

async function eventsNaming(messageId: MessageId): Promise<number> {
  return core.prisma.event.count({ where: { OR: [{ messageId }, { delivery: { messageId } }] } });
}

async function historyPruned(): Promise<number> {
  return core.prisma.event.count({ where: { fleetId: argo.fleetId, type: 'HistoryPruned' } });
}

async function storage(): Promise<bigint> {
  const days = await core.prisma.messageDay.findMany({ where: { fleetId: argo.fleetId } });
  return days.reduce((sum, day) => sum + day.payloadBytes, 0n);
}

describe('a pruning pass on Postgres', () => {
  it('lets a finished message past the retention go, with its deliveries and their events', async () => {
    const messageId = await aFinishedMessage();

    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    expect(await isKept(messageId)).toBe(false);
    expect(await core.prisma.delivery.count({ where: { messageId } })).toBe(0);
    expect(await eventsNaming(messageId)).toBe(0);
    expect(await historyPruned()).toBe(1);
  });

  it.each<DeliveryState>(['pending', 'received', 'handed', 'undeliverable', 'notHandled'])('keeps a message whose delivery is %s, at any age', async (state) => {
    const messageId = await sendTo(planner.shipId);
    await core.prisma.delivery.updateMany({ where: { messageId }, data: { state } });

    await passAfter(1_000 * DAY_MS);

    expect(await isKept(messageId)).toBe(true);
  });

  it('keeps an acknowledged delivery on an open pushed lease, whose crew may still re-read it', async () => {
    const messageId = await aFinishedMessage();
    await core.prisma.lease.updateMany({ where: { shipId: planner.shipId, endedAt: null }, data: { pushedAt: core.clock.now() } });

    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    expect(await isKept(messageId)).toBe(true);
  });

  it('keeps an open question, and lets an answered one go with its answer', async () => {
    const open = await sendTo(planner.shipId, { contentType: QUESTION_CONTENT_TYPE, payload: '{"id":"q-1","title":"Ship it?"}' });
    await acknowledged(planner, open);
    const answered = await sendTo(planner.shipId, { contentType: QUESTION_CONTENT_TYPE, payload: '{"id":"q-2","title":"Merge it?"}' });
    await acknowledged(planner, answered);
    const answer = await sendTo(scout.shipId, { from: planner, contentType: ANSWER_CONTENT_TYPE, payload: '{"questionId":"q-2","option":1}', inReplyTo: answered });
    await acknowledged(scout, answer);

    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    expect(await isKept(open)).toBe(true);
    expect(await isKept(answered)).toBe(false);
    expect(await isKept(answer)).toBe(false);
  });

  it('keeps a message a schedule replies to', async () => {
    const messageId = await aFinishedMessage();
    unwrap(
      await core.useCases.scheduleMessage(planner, {
        ...modelOf(planner),
        selector: { kind: 'ship', name: 'scout' },
        payload: 'Still on it',
        inReplyTo: messageId,
        idempotencyKey: newKey(),
        timing: { kind: 'once', at: new Date(core.clock.now().getTime() + 400 * DAY_MS) },
      }),
    );

    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    expect(await isKept(messageId)).toBe(true);
  });

  it('takes the pruned payload bytes off storage, and keeps the day counted', async () => {
    const before = await storage();
    await aFinishedMessage('x'.repeat(1_000));
    const sentDays = await core.prisma.messageDay.findMany({ where: { fleetId: argo.fleetId } });

    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    expect(await storage()).toBe(before);
    expect((await core.prisma.messageDay.findMany({ where: { fleetId: argo.fleetId } })).map((day) => day.messages)).toEqual(sentDays.map((day) => day.messages));
  });

  it('keeps a reply that names a pruned message, and refuses a new reply to it as not kept', async () => {
    const original = await aFinishedMessage();
    core.clock.advance((RETENTION_DAYS - 1) * DAY_MS);
    const reply = await sendTo(scout.shipId, { from: planner, inReplyTo: original });

    await passAfter(2 * DAY_MS);
    const refused = await core.useCases.sendMessage(planner, {
      ...modelOf(planner),
      selector: { kind: 'ship', shipId: scout.shipId },
      payload: 'One more thing',
      contentType: 'text/plain',
      idempotencyKey: newKey(),
      inReplyTo: original,
    });

    expect(await isKept(original)).toBe(false);
    expect(await isKept(reply)).toBe(true);
    expect(refused.isOk ? null : refused.error).toEqual({ kind: 'IN_REPLY_TO_NOT_FOUND', message: `Message ${original} is not in the fleet: it was never sent, or it is no longer kept` });
  });

  it('lets the mic and participant events of a meeting that ended before the cutoff go, and keeps the meeting', async () => {
    const chief = agentCaller({ fleetId: argo.fleetId, shipId: scout.shipId });
    const { meetingId } = unwrap(await core.useCases.openMeeting(chief, { ships: [{ shipId: planner.shipId }], idempotencyKey: newKey(), model: 'claude-opus-5-5' }));
    unwrap(await core.useCases.changeMeeting(chief, { meetingId, change: { kind: 'end' } }));

    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    const left = await core.prisma.$queryRaw<{ type: string }[]>`SELECT type FROM events WHERE details->>'meetingId' = ${meetingId} ORDER BY seq`;
    expect(left.map((event) => event.type)).not.toContain('ParticipantAdded');
    expect(await core.prisma.meeting.count({ where: { id: meetingId } })).toBe(1);
  });
});

/** A pruning pass with its own unit of work. */
function passWith(uow: UnitOfWork<PrismaTx>) {
  return createPruneHistory({ fleets: createPrismaFleetRepository(core.prisma), uow, clock: core.clock, ids: newId });
}

/** Longer than a send takes, shorter than a unit of work's timeout: a send still waiting by then waits on a lock. */
const RACE_WAIT_MS = 2_000;

/**
 * The pruning pass's batch, held once it locked its candidates: until another
 * transaction waits for one of its locks, or `until` settles.
 */
function heldAtCandidates(until?: Promise<unknown>) {
  return heldUnitOfWork(core.prisma, (tx, hold) => ({
    ...tx,
    historyPruner: {
      ...tx.historyPruner,
      candidates: async (...args) => {
        const candidates = await tx.historyPruner.candidates(...args);
        await hold(until?.then(() => undefined));
        return candidates;
      },
    },
  }));
}

/** Settles once `work` settles, or after the race wait, whichever comes first. */
function settledOrWaiting(work: Promise<unknown>): Promise<unknown> {
  return Promise.race([work.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, RACE_WAIT_MS))]);
}

describe('a pruning pass racing', () => {
  it('an acknowledgement of a delivery it holds: the delivery is acknowledged and its message kept', async () => {
    const messageId = await sendTo(planner.shipId);
    core.clock.advance(1_000);
    unwrap(await core.useCases.receiveDeliveries(planner, { max: 10 }));
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await core.useCases.closeHealthSnapshots();
    const held = heldAtCandidates();

    const passing = passWith(held.uow)();
    await held.reached;
    const { id } = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
    const ack = await core.useCases.acknowledgeDelivery(planner, { deliveryId: idSchema('delivery').parse(id) });
    await passing;

    expect(ack.isOk).toBe(true);
    expect(await isKept(messageId)).toBe(true);
  });

  it('a reply to a message it prunes: the reply is stored', async () => {
    const original = await aFinishedMessage();
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await core.useCases.closeHealthSnapshots();
    const replying = Promise.withResolvers<unknown>();
    const held = heldAtCandidates(settledOrWaiting(replying.promise));

    const passing = passWith(held.uow)();
    await held.reached;
    const reply = core.useCases.sendMessage(planner, {
      ...modelOf(planner),
      selector: { kind: 'ship', shipId: scout.shipId },
      payload: 'Done',
      contentType: 'text/plain',
      idempotencyKey: newKey(),
      inReplyTo: original,
    });
    replying.resolve(reply);
    await passing;

    expect((await reply).isOk).toBe(true);
    expect(await isKept(original)).toBe(false);
  });

  it("a second server's pass: it skips the fleet, and the history goes once", async () => {
    await aFinishedMessage();
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await core.useCases.closeHealthSnapshots();
    const second = Promise.withResolvers<undefined>();
    const held = heldAtCandidates(second.promise);

    const passing = passWith(held.uow)();
    await held.reached;
    await core.prisma.$executeRaw`UPDATE fleets SET pruned_at = NULL WHERE id = ${argo.fleetId}`;
    await passWith(createPrismaUnitOfWork(core.prisma))();
    second.resolve(undefined);
    await passing;

    expect(await historyPruned()).toBe(1);
  });

  it("the fleet's delete: the fleet is gone", async () => {
    await aFinishedMessage();
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await core.useCases.closeHealthSnapshots();
    const held = heldAtCandidates();

    const passing = passWith(held.uow)();
    await held.reached;
    const deleting = core.useCases.deleteFleet({ requestId: 'delete-home-fleet', fleetId: argo.fleetId });
    await Promise.allSettled([passing, deleting]);

    expect(await core.prisma.fleet.count({ where: { id: argo.fleetId } })).toBe(0);
  });
});

describe('a pruning pass that fails', () => {
  it('rolls a batch that fails mid-way back whole: nothing gone, no HistoryPruned, storage unchanged', async () => {
    const messageId = await aFinishedMessage();
    const before = await storage();
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await core.useCases.closeHealthSnapshots();
    const failing = createPrismaUnitOfWork(core.prisma);
    const uow: UnitOfWork<PrismaTx> = {
      run: (work) =>
        failing.run((tx) =>
          work({
            ...tx,
            historyPruner: {
              ...tx.historyPruner,
              go: async (...args) => {
                await tx.historyPruner.go(...args);
                throw new Error('disk full');
              },
            },
          }),
        ),
    };
    const failures: unknown[] = [];

    await passWith(uow)((_fleetId, error) => failures.push(error));

    expect(failures).toHaveLength(1);
    expect(await isKept(messageId)).toBe(true);
    expect(await eventsNaming(messageId)).toBeGreaterThan(0);
    expect(await historyPruned()).toBe(0);
    expect(await storage()).toBe(before);
  });

  it('goes on the next hour after a pass that died mid-way', async () => {
    const messageId = await aFinishedMessage();
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await core.useCases.closeHealthSnapshots();
    const dying = createPrismaUnitOfWork(core.prisma);
    await passWith({
      run: (work) =>
        dying.run((tx) =>
          work({
            ...tx,
            historyPruner: {
              ...tx.historyPruner,
              go: () => Promise.reject(new Error('server stopped')),
            },
          }),
        ),
    })();

    await core.useCases.pruneHistory();
    const isKeptWithinTheHour = await isKept(messageId);
    await passAfter(HOUR_MS);

    expect(isKeptWithinTheHour).toBe(true);
    expect(await isKept(messageId)).toBe(false);
  });
});
