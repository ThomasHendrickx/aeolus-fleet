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
import { OPERATOR } from '../src/testing/fleet.js';
import { createPostgresCore, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';

// Pruning finished history on a real Postgres (decision 0066; the retention
// design, R2, R6, R7, R11, R12 and R14): what is still on its way, or still
// waiting on a person, survives a pass at any age; what is finished past the
// retention goes with its deliveries and events and takes its bytes off
// storage; what the newest stuck snapshot has not folded stays (R7); and a
// pass racing a send, an acknowledgement, a lease end, a second server or a
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

  it.each<DeliveryState>(['pending', 'received', 'undeliverable', 'notHandled'])('keeps a message whose delivery is %s, at any age', async (state) => {
    const messageId = await sendTo(planner.shipId);
    await core.prisma.delivery.updateMany({ where: { messageId }, data: { state } });

    await passAfter(1_000 * DAY_MS);

    expect(await isKept(messageId)).toBe(true);
  });

  it('keeps a message whose delivery is handed, at any age', async () => {
    const messageId = await sendTo(planner.shipId);
    unwrap(await core.useCases.receiveDeliveries(planner, { max: 10 }));

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

  it('keeps a message acknowledged after the newest snapshot until the snapshot folds the acknowledgement (R7)', async () => {
    const messageId = await sendTo(planner.shipId);
    core.clock.advance(1_000);
    unwrap(await core.useCases.receiveDeliveries(planner, { max: 10 }));
    await passAfter((RETENTION_DAYS + 1) * DAY_MS);
    const { id } = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
    unwrap(await core.useCases.acknowledgeDelivery(planner, { deliveryId: idSchema('delivery').parse(id) }));
    core.clock.advance(HOUR_MS);

    await core.useCases.pruneHistory();
    const isKeptBeforeTheFold = await isKept(messageId);
    const acknowledgements = await core.prisma.event.count({ where: { deliveryId: id, type: 'DeliveryAcknowledged' } });
    await passAfter(HOUR_MS);

    expect(isKeptBeforeTheFold).toBe(true);
    expect(acknowledgements).toBe(1);
    expect(await isKept(messageId)).toBe(false);
    expect(await core.prisma.healthSnapshotDelivery.count({ where: { deliveryId: id } })).toBe(0);
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

describe("a pruning pass on Postgres, the rest of a fleet's finished history (S3)", () => {
  /** The scout's crew released: its lease ended and its secret invalidated, with LeaseRevoked and CredentialRevoked. */
  async function releaseScout(): Promise<void> {
    core.clock.advance(1_000);
    unwrap(await core.useCases.releaseShip(argo, { shipId: scout.shipId }));
  }

  async function eventTypes(): Promise<string[]> {
    return (await core.prisma.event.findMany({ where: { fleetId: argo.fleetId }, select: { type: true } })).map((event) => event.type);
  }

  async function signIn(): Promise<void> {
    core.clock.advance(1_000);
    unwrap(await core.useCases.signIn({ email: OPERATOR.email, password: OPERATOR.password }));
  }

  it("lets a crew's session and secret events past the retention go, and keeps the fleet's own changes", async () => {
    await releaseScout();

    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    expect((await eventTypes()).filter((type) => ['ShipClaimed', 'StartingPromptIssued', 'LeaseRevoked', 'CredentialRevoked'].includes(type))).toEqual([]);
    expect(await eventTypes()).toEqual(expect.arrayContaining(['FleetInitialised', 'ShipCommissioned', 'HistoryPruned']));
  });

  it("keeps a crew's session and secret events younger than the retention", async () => {
    await releaseScout();

    await passAfter((RETENTION_DAYS - 1) * DAY_MS);

    expect(await eventTypes()).toEqual(expect.arrayContaining(['ShipClaimed', 'StartingPromptIssued', 'LeaseRevoked', 'CredentialRevoked']));
  });

  it("keeps a crew's event the newest snapshot has not folded until it folds it (R7)", async () => {
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await core.useCases.closeHealthSnapshots();
    const id = newId('event');
    await core.prisma.$executeRaw`
      INSERT INTO events (id, fleet_id, type, occurred_at, ship_id, details, seq)
      SELECT ${id}, ${argo.fleetId}, 'ShipReported', ${new Date(core.clock.now().getTime() - (RETENTION_DAYS + 1) * DAY_MS)}, ${scout.shipId}, '{}'::jsonb, max(seq) + 1
      FROM events WHERE fleet_id = ${argo.fleetId}`;

    await core.useCases.pruneHistory();
    const isKeptBeforeTheFold = (await core.prisma.event.count({ where: { id } })) === 1;
    await passAfter(HOUR_MS);

    expect(isKeptBeforeTheFold).toBe(true);
    expect(await core.prisma.event.count({ where: { id } })).toBe(0);
  });

  it('lets a lease that ended and a secret invalidated before the cutoff go, and keeps the open ones and the ship', async () => {
    await releaseScout();

    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    expect(await core.prisma.lease.count({ where: { shipId: scout.shipId } })).toBe(0);
    expect(await core.prisma.credential.count({ where: { shipId: scout.shipId } })).toBe(0);
    expect(await core.prisma.lease.count({ where: { shipId: planner.shipId, endedAt: null } })).toBe(1);
    expect(await core.prisma.credential.count({ where: { shipId: planner.shipId, invalidatedAt: null } })).toBe(1);
    expect(await core.prisma.ship.count({ where: { id: scout.shipId } })).toBe(1);
  });

  it('keeps an ended lease a kept delivery names', async () => {
    const question = await sendTo(scout.shipId, { from: planner, contentType: QUESTION_CONTENT_TYPE });
    await acknowledged(scout, question);
    await releaseScout();

    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    expect(await isKept(question)).toBe(true);
    expect(await core.prisma.lease.count({ where: { shipId: scout.shipId } })).toBe(1);
  });

  it('lets a console session that ended before the cutoff go, with its notice dismissals, its guide progress and the lease it held', async () => {
    await signIn();
    const ended = await core.prisma.consoleSession.findFirstOrThrow({ where: { fleetId: argo.fleetId } });
    await core.prisma.noticeDismissal.create({ data: { fleetId: argo.fleetId, consoleSessionId: ended.id, noticeId: 'welcome', dismissedAt: core.clock.now() } });
    await core.prisma.guideProgress.create({ data: { fleetId: argo.fleetId, consoleSessionId: ended.id, step: 1, state: 'open', recordedAt: core.clock.now() } });
    await signIn();

    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    const live = await core.prisma.consoleSession.findMany({ where: { fleetId: argo.fleetId } });
    expect(live.map((session) => session.endedAt)).toEqual([null]);
    expect(await core.prisma.noticeDismissal.count({ where: { consoleSessionId: ended.id } })).toBe(0);
    expect(await core.prisma.guideProgress.count({ where: { consoleSessionId: ended.id } })).toBe(0);
    expect(await core.prisma.lease.count({ where: { id: ended.leaseId ?? undefined } })).toBe(0);
    expect(await core.prisma.lease.count({ where: { id: live[0]?.leaseId ?? undefined } })).toBe(1);
  });

  it('lets a console session that expired before the cutoff go, never ended, and keeps the open lease it held', async () => {
    await signIn();
    const expired = await core.prisma.consoleSession.findFirstOrThrow({ where: { fleetId: argo.fleetId } });

    await passAfter(expired.expiresAt.getTime() - core.clock.now().getTime() + (RETENTION_DAYS + 1) * DAY_MS);

    expect(await core.prisma.consoleSession.count({ where: { id: expired.id } })).toBe(0);
    expect(await core.prisma.lease.count({ where: { id: expired.leaseId ?? undefined, endedAt: null } })).toBe(1);
  });

  it('keeps an ended lease a live console session names', async () => {
    await signIn();
    const session = await core.prisma.consoleSession.findFirstOrThrow({ where: { fleetId: argo.fleetId } });
    await core.prisma.lease.update({ where: { id: session.leaseId ?? undefined }, data: { endedAt: core.clock.now() } });

    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    expect(await core.prisma.lease.count({ where: { id: session.leaseId ?? undefined } })).toBe(1);
  });

  it('lets a sign-in ticket used or expired before the cutoff go, and keeps a fresh one', async () => {
    const ticket = (tokenHash: string, { at, usedAt }: { at: Date; usedAt: Date | null }) => ({
      tokenHash,
      fleetId: argo.fleetId,
      signInAs: 'operator' as const,
      issuedAt: at,
      expiresAt: new Date(at.getTime() + 2 * 60_000),
      usedAt,
    });
    const at = core.clock.now();
    await core.prisma.signInTicket.createMany({ data: [ticket('used', { at, usedAt: at }), ticket('expired', { at, usedAt: null })] });
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await core.prisma.signInTicket.create({ data: ticket('fresh', { at: core.clock.now(), usedAt: null }) });

    await passAfter(0);

    expect((await core.prisma.signInTicket.findMany({ where: { fleetId: argo.fleetId } })).map((row) => row.tokenHash)).toEqual(['fresh']);
  });

  it('lets a reach refusal older than the retention go, and keeps a younger one', async () => {
    const refusal = (at: Date) => ({
      id: newId('reachRefusal'),
      fleetId: argo.fleetId,
      at,
      sender: { kind: 'ship', id: scout.shipId, name: 'scout', labels: [], owner: null },
      recipient: { kind: 'ship', ship: { id: planner.shipId, name: 'planner', labels: [], owner: null } },
      verb: 'send',
      settingsVersion: 1,
    });
    const old = refusal(core.clock.now());
    await core.prisma.reachRefusal.create({ data: old });
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    const young = refusal(core.clock.now());
    await core.prisma.reachRefusal.create({ data: young });

    await passAfter(0);

    expect((await core.prisma.reachRefusal.findMany({ where: { fleetId: argo.fleetId } })).map((row) => row.id)).toEqual([young.id]);
  });

  it('counts each kind that went in HistoryPruned', async () => {
    await releaseScout();

    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    const [event] = await core.prisma.event.findMany({ where: { fleetId: argo.fleetId, type: 'HistoryPruned' } });
    expect(event?.details).toMatchObject({ leases: 1, credentials: 1, consoleSessions: 0, signInTickets: 0, reachRefusals: 0 });
  });

  it('rolls a batch that fails mid-way back whole: the ended lease, its secret and their events stay', async () => {
    await releaseScout();
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await core.useCases.closeHealthSnapshots();
    const failing = createPrismaUnitOfWork(core.prisma);

    await passWith({
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
    })(() => undefined);

    expect(await core.prisma.lease.count({ where: { shipId: scout.shipId } })).toBe(1);
    expect(await core.prisma.credential.count({ where: { shipId: scout.shipId } })).toBe(1);
    expect(await eventTypes()).toEqual(expect.arrayContaining(['LeaseRevoked', 'CredentialRevoked']));
    expect(await historyPruned()).toBe(0);
  });
});

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

  it('a lease end that makes an acknowledged pushed delivery final: the lease ends, and the next pass lets the message go', async () => {
    const messageId = await aFinishedMessage();
    await core.prisma.lease.updateMany({ where: { shipId: planner.shipId, endedAt: null }, data: { pushedAt: core.clock.now() } });
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await core.useCases.closeHealthSnapshots();
    const releasing = Promise.withResolvers<unknown>();
    const held = heldAtCandidates(settledOrWaiting(releasing.promise));

    const passing = passWith(held.uow)();
    await held.reached;
    const release = core.useCases.releaseShip(argo, { shipId: planner.shipId });
    releasing.resolve(release);
    await passing;
    const isKeptByThePass = await isKept(messageId);
    await passAfter(HOUR_MS);

    expect((await release).isOk).toBe(true);
    expect(await core.prisma.lease.count({ where: { shipId: planner.shipId, endedAt: null } })).toBe(0);
    expect(isKeptByThePass).toBe(true);
    expect(await isKept(messageId)).toBe(false);
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
