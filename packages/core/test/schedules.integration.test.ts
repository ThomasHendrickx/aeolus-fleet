import { createIdGenerator, idSchema, type FleetId, type LabelValueId, type ScheduleId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import { listenForPendingDeliveries, type DeliveryListener } from '../src/adapters/prisma/delivery-notices.js';
import { createPrismaFleetRepository } from '../src/adapters/prisma/registry.js';
import { createPrismaScheduleAttempts } from '../src/adapters/prisma/schedules.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import type { ScheduleNotice } from '../src/domain/messaging/ports.js';
import type { MessageToSchedule } from '../src/domain/messaging/schedule-message.js';
import { createSendDueSchedules } from '../src/domain/messaging/send-due-schedules.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases } from '../src/wiring.js';
import { agentCaller, operatorCaller } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';

// Scheduled messages on a real Postgres through the Prisma adapters (decision
// 0062): what a schedule stores, the claim in SQL, and the guarantees: two
// servers never send the same send time twice, a send that fails midway
// stores nothing and advances nothing, a server that dies before commit
// leaves the send time for the next, one that dies after commit leaves
// nothing to send again, and reach is checked at creation and at the send
// time. The test clock stands a month before the database's clock: a
// schedule made for an hour ahead on the test clock is due by the database's
// now(), as the claim judges it.

const newId = createIdGenerator();
const MODEL = 'claude-opus-5-5';
const SEND_TIME = '2026-09-29T13:00:00.000Z';
/** Longer than a claim takes, shorter than a unit of work's timeout: a claim still waiting by then waits on a lock. */
const CLAIM_WAIT_MS = 2_000;

let core: PostgresCore;
let fleetId: FleetId;
let argo: ShipCaller;
let scout: ShipCaller;
let chiefId: ShipId;
let listener: DeliveryListener;
let scheduleNotices: ScheduleNotice[];

async function commissioned(name: string, type: string): Promise<ShipId> {
  return unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type })).shipId;
}

function aSchedule(overrides: Partial<MessageToSchedule> = {}): MessageToSchedule {
  return { selector: { kind: 'ship', name: 'chief' }, payload: 'Check in', model: MODEL, idempotencyKey: newKey(), timing: { kind: 'once', at: new Date(SEND_TIME) }, ...overrides };
}

async function scheduled(input: MessageToSchedule = aSchedule()): Promise<ScheduleId> {
  return unwrap(await core.useCases.scheduleMessage(scout, input)).scheduleId;
}

/** A pass of a server with its own unit of work. */
function passWith(uow: UnitOfWork<PrismaTx>) {
  return createSendDueSchedules({
    fleets: createPrismaFleetRepository(core.prisma),
    scheduleAttempts: createPrismaScheduleAttempts(core.prisma),
    uow,
    clock: core.clock,
    ids: newId,
    hasher: sha256Hasher,
  });
}

/** The Prisma unit of work with a step of the pass wrapped. */
function unitOfWorkWith(wrap: (tx: PrismaTx) => PrismaTx): UnitOfWork<PrismaTx> {
  const uow = createPrismaUnitOfWork(core.prisma);
  return { run: (work) => uow.run((tx) => work(wrap(tx))) };
}

async function messagesOf(scheduleId: ScheduleId) {
  return core.prisma.message.findMany({ where: { fleetId, scheduleId } });
}

async function scheduleRow(scheduleId: ScheduleId) {
  return core.prisma.schedule.findFirst({ where: { fleetId, id: scheduleId } });
}

/** Waits until the listener has heard as many schedule notices, or a second has passed. */
async function heardSchedules(count: number): Promise<ScheduleNotice[]> {
  const until = Date.now() + 1_000;
  while (scheduleNotices.length < count && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return scheduleNotices;
}

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' })));
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  scout = agentCaller({ fleetId, shipId: await commissioned('scout', 'reviewer') });
  chiefId = await commissioned('chief', 'chief-of-staff');
  scheduleNotices = [];
  listener = listenForPendingDeliveries({
    databaseUrl: core.databaseUrl,
    onNotice: () => undefined,
    onScheduleDue: (notice) => {
      scheduleNotices.push(notice);
    },
  });
  await listener.listening;
});

afterEach(async () => {
  await listener.close();
  await core.close();
});

describe('a schedule on Postgres', () => {
  it('stores the send input as given, its strategy and its next send time, and tells the timers after commit', async () => {
    const scheduleId = await scheduled(aSchedule({ contentType: 'application/json', onRefused: 'retry', retryWindow: 'PT30M' }));

    expect(await scheduleRow(scheduleId)).toMatchObject({
      shipId: scout.shipId,
      selectorKind: 'ship',
      selectorShipName: 'chief',
      selectorShipId: null,
      payload: 'Check in',
      contentType: 'application/json',
      model: MODEL,
      onRefused: 'retry',
      retryWindow: 'PT30M',
      state: 'active',
      nextSendTime: new Date(SEND_TIME),
      nextAttemptAt: new Date(SEND_TIME),
    });
    expect(await heardSchedules(1)).toEqual([{ fleetId, scheduleId, attemptAt: new Date(SEND_TIME) }]);
  });

  it('answers one schedule for two creations at once with one key', async () => {
    const input = aSchedule();

    const [first, second] = await Promise.all([core.useCases.scheduleMessage(scout, input), core.useCases.scheduleMessage(scout, input)]);

    expect(unwrap(first)).toEqual(unwrap(second));
    expect(await core.prisma.schedule.count({ where: { fleetId } })).toBe(1);
  });

  it('refuses a selector the creator does not reach, storing only the refusal record', async () => {
    const networking = agentCaller({ fleetId, shipId: unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'networking', type: 'networking', scopes: ['fleet:network'] })).shipId });
    const { savedAgainstVersion } = unwrap(await core.useCases.saveNetworkRulesDraft({ ...networking, scopes: ['fleet:network'] }, { rules: [] }));
    unwrap(await core.useCases.applyNetworkRules({ ...networking, scopes: ['fleet:network'] }, { version: savedAgainstVersion }));

    const refused = await core.useCases.scheduleMessage(scout, aSchedule());

    expect(refused).toMatchObject({ isOk: false, error: { kind: 'NOT_REACHABLE' } });
    expect(await core.prisma.schedule.count({ where: { fleetId } })).toBe(0);
    expect(await core.prisma.reachRefusal.count({ where: { fleetId, verb: 'send' } })).toBe(1);
  });

  it('lists and cancels on Postgres, newest first, by state', async () => {
    const first = await scheduled();
    core.clock.advance(1);
    const second = await scheduled();
    unwrap(await core.useCases.cancelSchedule(scout, { scheduleId: first }));

    const open = unwrap(await core.useCases.listSchedules(scout, { shipId: scout.shipId, limit: 20 }));
    const all = unwrap(await core.useCases.listSchedules(scout, { shipId: scout.shipId, limit: 1, states: ['active', 'cancelled'] }));

    expect(open.items.map((schedule) => schedule.id)).toEqual([second]);
    expect([all.items.map((schedule) => schedule.id), all.nextCursor]).toEqual([[second], second]);
    expect(await scheduleRow(first)).toMatchObject({ state: 'cancelled', nextSendTime: null, nextAttemptAt: null });
  });
});

describe('a send time on Postgres', () => {
  it('sends the message as its ship with its schedule and send time on the envelope, and ends the schedule with it', async () => {
    const scheduleId = await scheduled();

    await core.useCases.sendDueSchedules();

    const [message] = await messagesOf(scheduleId);
    expect(message).toMatchObject({ senderShipId: scout.shipId, selectorShipId: chiefId, payload: 'Check in', idempotencyKey: `schedule:${scheduleId}:${SEND_TIME}`, sendTime: new Date(SEND_TIME) });
    expect(await scheduleRow(scheduleId)).toMatchObject({ state: 'ended', nextSendTime: null, nextAttemptAt: null, lastOutcomeKind: 'sent', lastMessageId: message?.id, lastSendTime: new Date(SEND_TIME) });
    expect(await core.prisma.event.count({ where: { fleetId, type: { in: ['MessageAccepted', 'ScheduleEnded'] } } })).toBe(2);
  });

  it('checks reach at the send time: refused under rules applied since, recorded on the schedule with the refusal record', async () => {
    const scheduleId = await scheduled();
    const networking = agentCaller({ fleetId, shipId: unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'networking', type: 'networking', scopes: ['fleet:network'] })).shipId });
    const rules = { ...networking, scopes: ['fleet:network' as const] };
    const { savedAgainstVersion } = unwrap(await core.useCases.saveNetworkRulesDraft(rules, { rules: [] }));
    unwrap(await core.useCases.applyNetworkRules(rules, { version: savedAgainstVersion }));

    await core.useCases.sendDueSchedules();

    expect(await messagesOf(scheduleId)).toEqual([]);
    expect(await scheduleRow(scheduleId)).toMatchObject({ state: 'ended', lastOutcomeKind: 'refused', lastRefusalCode: 'NOT_REACHABLE', lastSendTime: new Date(SEND_TIME) });
    expect(await core.prisma.reachRefusal.count({ where: { fleetId, verb: 'send' } })).toBe(1);
  });

  it('is cancelled by its ship retiring, in the same transaction, and sends nothing after', async () => {
    const scheduleId = await scheduled();

    unwrap(await core.useCases.retireShip(argo, { shipId: scout.shipId }));
    await core.useCases.sendDueSchedules();

    expect(await scheduleRow(scheduleId)).toMatchObject({ state: 'cancelled' });
    expect(await messagesOf(scheduleId)).toEqual([]);
    expect(await core.prisma.event.count({ where: { fleetId, type: 'ScheduleCancelled', shipId: scout.shipId } })).toBe(1);
  });

  it('goes with its fleet when the fleet is deleted', async () => {
    const scheduleId = await scheduled();
    await core.useCases.sendDueSchedules();
    await scheduled();

    await core.prisma.$transaction((tx) => createPrismaFleetRepository(tx).delete(fleetId));

    expect([await core.prisma.schedule.count({ where: { fleetId } }), await core.prisma.message.count({ where: { fleetId, scheduleId } })]).toEqual([0, 0]);
  });
});

describe('two servers', () => {
  it('never send the same send time twice: both passing at once over many schedules send one message each', async () => {
    const scheduleIds: ScheduleId[] = [];
    for (let at = 0; at < 20; at += 1) {
      scheduleIds.push(await scheduled());
    }
    const other = createPrismaClient(core.databaseUrl);
    try {
      const otherServer = createUseCases({ prisma: other, clock: core.clock });

      await Promise.all([core.useCases.sendDueSchedules(), otherServer.sendDueSchedules(), core.useCases.sendDueSchedules(), otherServer.sendDueSchedules()]);
    } finally {
      await other.$disconnect();
    }

    const sent = await core.prisma.message.groupBy({ by: ['scheduleId'], where: { fleetId, scheduleId: { in: scheduleIds } }, _count: { _all: true } });
    expect(sent).toHaveLength(20);
    expect(sent.every((row) => row._count._all === 1)).toBe(true);
    expect(await core.prisma.schedule.count({ where: { fleetId, state: 'ended' } })).toBe(20);
  });

  it('end a schedule once when two claims meet', async () => {
    const scheduleId = await scheduled();
    const racing = racingUnitOfWork({ prisma: core.prisma, transactions: 2 }, (tx, allArrived) => ({
      ...tx,
      schedules: {
        ...tx.schedules,
        claimDue: async (claimFleetId, excluding) => {
          await allArrived();
          return tx.schedules.claimDue(claimFleetId, excluding);
        },
      },
    }));
    const pass = passWith(racing);

    await Promise.all([pass(), pass()]);

    // One claim only: a second one would end the schedule a second time, even where the key keeps it to one message.
    expect(await messagesOf(scheduleId)).toHaveLength(1);
    expect(await core.prisma.event.count({ where: { fleetId, type: 'ScheduleEnded' } })).toBe(1);
  });

  it('never waits on a schedule another server holds: a second claim skips it at once and takes the next one due', async () => {
    const held = await scheduled();
    const next = await scheduled();
    const uow = createPrismaUnitOfWork(core.prisma);
    let releaseFirst = (): void => undefined;
    const isReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let claimedFirst: (claim: ScheduleId | undefined) => void = () => undefined;
    const firstClaim = new Promise<ScheduleId | undefined>((resolve) => {
      claimedFirst = resolve;
    });
    const first = uow.run(async (tx) => {
      claimedFirst((await tx.schedules.claimDue(fleetId, []))?.id);
      await isReleased;
      return { isOk: true as const, value: undefined };
    });
    try {
      expect(await firstClaim).toBe(held);

      // Without SKIP LOCKED the second claim would wait on the held row until the first transaction ends.
      const waited = new Promise<'waited'>((resolve) => setTimeout(() => {
          resolve('waited');
        }, CLAIM_WAIT_MS));
      const second = uow.run(async (tx) => ({ isOk: true as const, value: (await tx.schedules.claimDue(fleetId, []))?.id }));

      expect(await Promise.race([second.then((claim) => (claim.isOk ? claim.value : undefined)), waited])).toBe(next);
    } finally {
      releaseFirst();
      await first;
    }
  });

  it('store no second message even for a second claim of the same send time: the derived key finds the first', async () => {
    const scheduleId = await scheduled();
    const stale = await createPrismaUnitOfWork(core.prisma).run(async (tx) => ({ isOk: true as const, value: await tx.schedules.findForUpdate(fleetId, scheduleId) }));
    await core.useCases.sendDueSchedules();
    let isClaimed = false;
    const secondClaim = passWith(
      unitOfWorkWith((tx) => ({
        ...tx,
        schedules: {
          ...tx.schedules,
          claimDue: () => {
            const claim = isClaimed ? undefined : stale.isOk ? stale.value : undefined;
            isClaimed = true;
            return Promise.resolve(claim);
          },
        },
      })),
    );

    await secondClaim();

    expect(await messagesOf(scheduleId)).toHaveLength(1);
  });
});

describe('a send that fails before commit', () => {
  it('rolls back: no message, no delivery, no event, no notice, and the send time not advanced', async () => {
    const scheduleId = await scheduled();
    await heardSchedules(1);
    const before = await scheduleRow(scheduleId);
    const events = await core.prisma.event.count({ where: { fleetId } });
    const errors: unknown[] = [];
    const failing = passWith(
      unitOfWorkWith((tx) => ({
        ...tx,
        schedules: { ...tx.schedules, save: () => Promise.reject(new Error('the server failed before commit')) },
      })),
    );

    await failing((_fleetId, error) => errors.push(error));

    expect(errors).toHaveLength(1);
    expect([await core.prisma.message.count({ where: { fleetId } }), await core.prisma.delivery.count({ where: { fleetId } }), await core.prisma.event.count({ where: { fleetId } })]).toEqual([0, 0, events]);
    expect(await scheduleRow(scheduleId)).toEqual(before);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(scheduleNotices).toHaveLength(1);
  });

  it('leaves the send time to the next server when the server dies mid-transaction: sent once there', async () => {
    const scheduleId = await scheduled();
    const dying = createPrismaClient(core.databaseUrl);
    try {
      const dyingUow = createPrismaUnitOfWork(dying);
      const dyingPass = createSendDueSchedules({
        fleets: createPrismaFleetRepository(dying),
        scheduleAttempts: createPrismaScheduleAttempts(dying),
        uow: {
          run: (work) =>
            dyingUow.run((tx) =>
              work({
                ...tx,
                schedules: {
                  ...tx.schedules,
                  save: async (schedule) => {
                    // The message is stored in this transaction, which waits idle on the server; then its
                    // connection dies, as a killed server's does. No other transaction of this database waits so.
                    await core.prisma.$queryRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'`;
                    return tx.schedules.save(schedule);
                  },
                },
              }),
            ),
        },
        clock: core.clock,
        ids: newId,
        hasher: sha256Hasher,
      });

      await dyingPass(() => undefined).catch(() => undefined);
    } finally {
      await dying.$disconnect().catch(() => undefined);
    }
    expect(await messagesOf(scheduleId)).toEqual([]);
    expect(await scheduleRow(scheduleId)).toMatchObject({ state: 'active', nextAttemptAt: new Date(SEND_TIME) });

    const restarted = createPrismaClient(core.databaseUrl);
    try {
      await createUseCases({ prisma: restarted, clock: core.clock }).sendDueSchedules();
    } finally {
      await restarted.$disconnect();
    }

    expect(await messagesOf(scheduleId)).toHaveLength(1);
  });
});

describe('a restart after commit', () => {
  it('sends nothing again: the send time was advanced with the message', async () => {
    const scheduleId = await scheduled();
    await core.useCases.sendDueSchedules();

    const restarted = createPrismaClient(core.databaseUrl);
    try {
      await createUseCases({ prisma: restarted, clock: core.clock }).sendDueSchedules();
    } finally {
      await restarted.$disconnect();
    }

    expect(await messagesOf(scheduleId)).toHaveLength(1);
  });
});

describe('running servers', () => {
  /** Long enough that only a server's timer sends within a test: the 30 second pass never runs. */
  const NO_PASS_MS = 600_000;

  it("send a schedule at its time by a server's timer, told by the NOTIFY of its creation, once across two servers", async () => {
    const servers = [
      createApp({ databaseUrl: core.databaseUrl, publicUrl: 'http://localhost:3000', logger: false, overduePassMs: NO_PASS_MS }),
      createApp({ databaseUrl: core.databaseUrl, publicUrl: 'http://localhost:3000', logger: false, overduePassMs: NO_PASS_MS }),
    ];
    try {
      await Promise.all(servers.map((server) => server.ready()));
      // Long enough for both servers to listen and run their first send before the schedule is made.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      core.clock.set(new Date().toISOString());
      const scheduleId = await scheduled(aSchedule({ timing: { kind: 'once', at: new Date(Date.now() + 1_000) } }));
      expect(await messagesOf(scheduleId)).toEqual([]);

      const until = Date.now() + 5_000;
      while ((await messagesOf(scheduleId)).length === 0 && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));

      expect(await messagesOf(scheduleId)).toHaveLength(1);
    } finally {
      await Promise.all(servers.map((server) => server.close()));
    }
  });
});

describe('a repeating schedule on Postgres', () => {
  /** Every minute from 12:00 on the test clock; the database's clock is a month on, so every send time is due by its now(). */
  const everyMinute = (overrides: Partial<MessageToSchedule> = {}) => aSchedule({ timing: { kind: 'every', every: 'PT1M' }, ...overrides });

  async function sendTimesOf(scheduleId: ScheduleId): Promise<string[]> {
    return (await core.prisma.message.findMany({ where: { fleetId, scheduleId }, orderBy: { sendTime: 'asc' } })).map((message) => message.sendTime?.toISOString() ?? '');
  }

  it('stores and lists its timing, its bounds and its strategies as given', async () => {
    const timing = { kind: 'cron', cron: '0 9 * * MON-FRI', timeZone: 'Europe/Brussels', start: new Date('2026-10-01T00:00:00.000Z'), end: new Date('2026-12-31T00:00:00.000Z'), count: 40 } as const;
    const cron = await scheduled(aSchedule({ timing, onMissed: 'once', grace: 'PT10M' }));
    const every = await scheduled(everyMinute());

    const listed = unwrap(await core.useCases.listSchedules(scout, { shipId: scout.shipId, limit: 20 }));

    expect(listed.items.map((schedule) => [schedule.id, schedule.timing, schedule.onMissed, schedule.grace, schedule.nextSendTime])).toEqual([
      [every, { kind: 'every', every: 'PT1M', start: null, end: null, count: null }, 'each', 'PT5M', new Date('2026-09-29T12:01:00.000Z')],
      [cron, timing, 'once', 'PT10M', new Date('2026-10-01T07:00:00.000Z')],
    ]);
  });

  it('sends each send time of a catch-up once, at most 100 a unit of work, stamped with its own send time', async () => {
    const scheduleId = await scheduled(everyMinute());
    core.clock.advance(150 * 60_000);

    await core.useCases.sendDueSchedules();

    expect(await sendTimesOf(scheduleId)).toHaveLength(100);
    expect(await scheduleRow(scheduleId)).toMatchObject({ state: 'active', nextSendTime: new Date('2026-09-29T13:41:00.000Z') });
  });

  it('counts its sends from the messages it stored: ended at its count', async () => {
    const scheduleId = await scheduled(everyMinute({ timing: { kind: 'every', every: 'PT1M', count: 3 } }));
    core.clock.advance(2 * 60_000);
    await core.useCases.sendDueSchedules();
    core.clock.advance(5 * 60_000);

    await core.useCases.sendDueSchedules();

    expect(await sendTimesOf(scheduleId)).toEqual(['2026-09-29T12:01:00.000Z', '2026-09-29T12:02:00.000Z', '2026-09-29T12:03:00.000Z']);
    expect(await scheduleRow(scheduleId)).toMatchObject({ state: 'ended', nextSendTime: null });
  });

  it('records a missed send time as its last outcome under skip', async () => {
    const scheduleId = await scheduled(everyMinute({ onMissed: 'skip' }));
    core.clock.advance(10 * 60_000);

    await core.useCases.sendDueSchedules();

    expect(await sendTimesOf(scheduleId)).toEqual(['2026-09-29T12:05:00.000Z', '2026-09-29T12:06:00.000Z', '2026-09-29T12:07:00.000Z', '2026-09-29T12:08:00.000Z', '2026-09-29T12:09:00.000Z', '2026-09-29T12:10:00.000Z']);
    expect(await core.prisma.event.count({ where: { fleetId, type: 'ScheduledSendMissed' } })).toBe(4);
  });

  it('pauses and resumes on Postgres, skipping the send times passed while paused', async () => {
    const scheduleId = await scheduled(everyMinute());
    unwrap(await core.useCases.pauseSchedule(scout, { scheduleId }));
    core.clock.advance(10 * 60_000 + 30_000);
    await core.useCases.sendDueSchedules();

    unwrap(await core.useCases.resumeSchedule(scout, { scheduleId }));

    expect(await sendTimesOf(scheduleId)).toEqual([]);
    expect(await scheduleRow(scheduleId)).toMatchObject({ state: 'active', nextSendTime: new Date('2026-09-29T12:11:00.000Z'), nextAttemptAt: new Date('2026-09-29T12:11:00.000Z') });
  });

  it('two servers never send the same send time twice over a catch-up: each send time one message', async () => {
    const scheduleIds = [await scheduled(everyMinute()), await scheduled(everyMinute()), await scheduled(everyMinute())];
    core.clock.advance(150 * 60_000);
    const other = createPrismaClient(core.databaseUrl);
    try {
      const otherServer = createUseCases({ prisma: other, clock: core.clock });

      await Promise.all([core.useCases.sendDueSchedules(), otherServer.sendDueSchedules(), core.useCases.sendDueSchedules(), otherServer.sendDueSchedules()]);
      await Promise.all([core.useCases.sendDueSchedules(), otherServer.sendDueSchedules()]);
    } finally {
      await other.$disconnect();
    }

    // A pass may also send the next send time of a schedule it caught up: the database's clock, which judges it due, is a month on.
    const sent = await core.prisma.message.groupBy({ by: ['scheduleId', 'sendTime'], where: { fleetId, scheduleId: { in: scheduleIds } }, _count: { _all: true } });
    expect(sent.length).toBeGreaterThanOrEqual(3 * 150);
    expect(sent.filter((row) => row._count._all !== 1)).toEqual([]);
  });

  it('rolls back a whole catch-up that fails before commit: no message, and the send time not advanced', async () => {
    const scheduleId = await scheduled(everyMinute());
    core.clock.advance(30 * 60_000);
    const before = await scheduleRow(scheduleId);
    const failing = passWith(
      unitOfWorkWith((tx) => ({
        ...tx,
        schedules: { ...tx.schedules, save: () => Promise.reject(new Error('the server failed before commit')) },
      })),
    );

    await failing(() => undefined);

    expect(await sendTimesOf(scheduleId)).toEqual([]);
    expect(await scheduleRow(scheduleId)).toEqual(before);
  });
});

describe('a schedule to a label on Postgres (decision 0065, D6)', () => {
  let teamA: LabelValueId;
  let bravoId: ShipId;

  /** Every minute from 12:00 on the test clock: each pass sends one send time, the next one a minute ahead of the server's clock. */
  const toTeamA = (overrides: Partial<MessageToSchedule> = {}) => aSchedule({ selector: { kind: 'label', valueIds: [teamA] }, timing: { kind: 'every', every: 'PT1M' }, ...overrides });

  async function recipientsBySendTime(scheduleId: ScheduleId): Promise<[string, ShipId[]][]> {
    const messages = await core.prisma.message.findMany({ where: { fleetId, scheduleId }, orderBy: { sendTime: 'asc' }, include: { deliveries: { orderBy: { recipientShipId: 'asc' } } } });
    return messages.map((message) => [message.sendTime?.toISOString() ?? '', message.deliveries.map((delivery) => idSchema('ship').parse(delivery.recipientShipId))]);
  }

  beforeEach(async () => {
    bravoId = await commissioned('bravo', 'reviewer');
    const team = unwrap(await core.useCases.defineLabel(argo, { key: 'team', values: ['a'] }));
    const [a] = team.values.map((value) => value.id);
    if (a === undefined) {
      throw new Error('the team label has no value a');
    }
    teamA = a;
    for (const shipId of [scout.shipId, chiefId]) {
      unwrap(await core.useCases.assignLabel(argo, { shipId, valueId: teamA }));
    }
  });

  it('stores and lists the label selection as given', async () => {
    const scheduleId = await scheduled(toTeamA());

    const listed = unwrap(await core.useCases.listSchedules(scout, { shipId: scout.shipId, limit: 20 }));

    expect(await scheduleRow(scheduleId)).toMatchObject({ selectorKind: 'label', selectorValueIds: [teamA], selectorShipId: null, selectorShipName: null, selectorType: null });
    expect(listed.items.map((schedule) => schedule.send.selector)).toEqual([{ kind: 'label', valueIds: [teamA] }]);
  });

  it('sends each send time to the ships carrying the selection then: a ship labelled between two send times gets the second only', async () => {
    const scheduleId = await scheduled(toTeamA());

    await core.useCases.sendDueSchedules();
    unwrap(await core.useCases.assignLabel(argo, { shipId: bravoId, valueId: teamA }));
    core.clock.advance(60_000);
    await core.useCases.sendDueSchedules();

    expect(await recipientsBySendTime(scheduleId)).toEqual([
      ['2026-09-29T12:01:00.000Z', [chiefId]],
      ['2026-09-29T12:02:00.000Z', [bravoId, chiefId].sort()],
    ]);
  });

  it('refuses a send time the creator no longer reaches one ship of, recorded on the schedule with the refusal record, and goes on', async () => {
    const scheduleId = await scheduled(toTeamA());
    const networking = agentCaller({ fleetId, shipId: unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'networking', type: 'networking', scopes: ['fleet:network'] })).shipId });
    const rules = { ...networking, scopes: ['fleet:network' as const] };
    const { savedAgainstVersion } = unwrap(await core.useCases.saveNetworkRulesDraft(rules, { rules: [] }));
    unwrap(await core.useCases.applyNetworkRules(rules, { version: savedAgainstVersion }));

    await core.useCases.sendDueSchedules();

    expect(await messagesOf(scheduleId)).toEqual([]);
    expect(await scheduleRow(scheduleId)).toMatchObject({ state: 'active', lastOutcomeKind: 'refused', lastRefusalCode: 'NOT_REACHABLE', lastSendTime: new Date('2026-09-29T12:01:00.000Z') });
    expect(await core.prisma.reachRefusal.count({ where: { fleetId, verb: 'send' } })).toBe(1);
  });
});
