import type { FleetId, ScheduleId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL, withInstallationSettings } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore, type InMemoryTx } from '../../../test/support/in-memory.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { MessageToSchedule } from './schedule-message.js';
import { createSendDueSchedules } from './send-due-schedules.js';

/**
 * A schedule's send time (decision 0062): scout schedules a check-in to
 * chief for 10:00, made at 09:00. Each pass is one call of the use case.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let scout: ShipCaller;
let chief: ShipCaller;
let networking: ShipCaller;

const SEND_TIME = '2026-10-25T10:00:00.000Z';
const RETRY_EVERY_MS = 30_000;

function aSchedule(overrides: Partial<MessageToSchedule> = {}): MessageToSchedule {
  return {
    selector: { kind: 'ship', name: 'chief' },
    payload: 'Check in: what changed in the last 6 hours?',
    model: SESSION_MODEL,
    idempotencyKey: newKey(),
    timing: { kind: 'once', at: new Date(SEND_TIME) },
    ...overrides,
  };
}

async function scheduled(input: MessageToSchedule = aSchedule(), by: ShipCaller = scout): Promise<ScheduleId> {
  return unwrap(await messaging.scheduleMessage(by, input)).scheduleId;
}

function scheduleOf(scheduleId: ScheduleId) {
  return core.state.schedules.find((schedule) => schedule.id === scheduleId);
}

/** Lets only the ships labelled role=chief send: scout reaches nobody then. */
async function onlyChiefSends(): Promise<void> {
  unwrap(await registry.defineLabel(argo, { key: 'role', values: ['chief'] }));
  unwrap(await registry.assignLabel(argo, { shipId: chief.shipId, valueId: valueIdOf(core, { key: 'role', value: 'chief' }) }));
  await applyNetworkRules(registry, { by: networking, rules: [{ verb: 'send', from: [valueIdOf(core, { key: 'role', value: 'chief' })], to: [] }] });
}

async function everyoneSends(): Promise<void> {
  await applyNetworkRules(registry, { by: networking, rules: null });
}

function pass() {
  return messaging.sendDueSchedules();
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-25T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: ['messages:force'] });
  chief = await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: [] });
  networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
});

describe('a send time', () => {
  it('sends nothing before its time', async () => {
    await scheduled();
    core.clock.set('2026-10-25T09:59:59.999Z');

    await pass();

    expect(core.state.messages).toEqual([]);
  });

  it('sends the message as its ship at its time, with its payload as stored and its schedule and send time on the envelope', async () => {
    const scheduleId = await scheduled(aSchedule({ contentType: 'application/vnd.aeolus.check-in+json' }));
    core.clock.set(SEND_TIME);

    await pass();

    expect(core.state.messages).toEqual([
      expect.objectContaining({
        senderShipId: scout.shipId,
        selector: { kind: 'ship', shipId: chief.shipId },
        payload: 'Check in: what changed in the last 6 hours?',
        contentType: 'application/vnd.aeolus.check-in+json',
        model: SESSION_MODEL,
        idempotencyKey: `schedule:${scheduleId}:${SEND_TIME}`,
        scheduleId,
        sendTime: new Date(SEND_TIME),
        createdAt: new Date(SEND_TIME),
      }),
    ]);
    expect(core.state.deliveries).toEqual([expect.objectContaining({ recipient: { kind: 'ship', shipId: chief.shipId }, state: 'pending', isForced: false })]);
    expect(core.state.notices).toEqual([expect.objectContaining({ recipient: { kind: 'ship', shipId: chief.shipId } })]);
  });

  it("hands the recipient a delivery that names the schedule and its send time", async () => {
    const scheduleId = await scheduled();
    core.clock.set(SEND_TIME);
    await pass();

    const { deliveries } = unwrap(await messaging.receiveDeliveries(crewAboard(core, chief), {}));

    expect(deliveries).toEqual([expect.objectContaining({ senderShipId: scout.shipId, scheduleId, sendTime: new Date(SEND_TIME) })]);
  });

  it('sends a forced schedule forced, and a reply as a reply', async () => {
    const { messageId } = unwrap(await messaging.sendMessage(chief, { selector: { kind: 'ship', name: 'scout' }, payload: 'Remind me', model: SESSION_MODEL, idempotencyKey: newKey() }));
    await scheduled(aSchedule({ isForced: true, inReplyTo: messageId }));
    core.clock.set(SEND_TIME);

    await pass();

    expect(core.state.messages.at(-1)).toMatchObject({ inReplyToMessageId: messageId });
    expect(core.state.deliveries.at(-1)).toMatchObject({ isForced: true });
  });

  it('names the schedule and send time on MessageAccepted, and ends the once schedule with its outcome and ScheduleEnded', async () => {
    const scheduleId = await scheduled();
    core.clock.set('2026-10-25T10:00:05.000Z');
    core.state.events.length = 0;

    await pass();

    const [message] = core.state.messages;
    expect(core.state.events.map((event) => [event.type, event.shipId, event.details])).toEqual([
      ['MessageAccepted', chief.shipId, expect.objectContaining({ scheduleId, sendTime: SEND_TIME })],
      ['ScheduleEnded', scout.shipId, { scheduleId, outcome: 'sent' }],
    ]);
    expect(scheduleOf(scheduleId)).toMatchObject({
      state: 'ended',
      nextSendTime: null,
      nextAttemptAt: null,
      lastOutcome: { kind: 'sent', messageId: message?.id, sendTime: new Date(SEND_TIME), at: new Date('2026-10-25T10:00:05.000Z') },
      endedAt: new Date('2026-10-25T10:00:05.000Z'),
    });
  });

  it('sends each send time once: a later pass sends nothing again', async () => {
    await scheduled();
    core.clock.set(SEND_TIME);

    await pass();
    core.clock.advance(RETRY_EVERY_MS);
    await pass();

    expect(core.state.messages).toHaveLength(1);
  });

  it('still sends a once schedule the pass reaches late, hours after its time, with its own send time', async () => {
    const scheduleId = await scheduled();
    core.clock.set('2026-10-25T16:30:00.000Z');

    await pass();

    expect(core.state.messages).toEqual([expect.objectContaining({ scheduleId, sendTime: new Date(SEND_TIME), createdAt: new Date('2026-10-25T16:30:00.000Z') })]);
  });

  it('sends every schedule that is due in one pass, and answers the earliest attempt still ahead', async () => {
    await scheduled();
    await scheduled(aSchedule({ selector: { kind: 'type', type: 'chief-of-staff' } }));
    await scheduled(aSchedule({ timing: { kind: 'once', at: new Date('2026-10-25T12:00:00.000Z') } }));
    core.clock.set(SEND_TIME);

    await expect(pass()).resolves.toEqual({ nextAttemptAt: new Date('2026-10-25T12:00:00.000Z') });
    expect(core.state.messages).toHaveLength(2);
  });

  it('answers no attempt ahead when none is', async () => {
    await expect(pass()).resolves.toEqual({ nextAttemptAt: undefined });
  });

  it('sends nothing for a cancelled schedule', async () => {
    const scheduleId = await scheduled();
    unwrap(await messaging.cancelSchedule(scout, { scheduleId }));
    core.clock.set(SEND_TIME);

    await pass();

    expect(core.state.messages).toEqual([]);
  });

  it('goes on while its ship awaits crew: scout has none, and the message waits as any message', async () => {
    const scheduleId = await scheduled();
    core.clock.set(SEND_TIME);

    await pass();

    expect(core.state.messages).toEqual([expect.objectContaining({ scheduleId })]);
  });

  it('counts toward the daily message limit', async () => {
    withInstallationSettings(core, { defaultDailyMessageLimit: 1 });
    await scheduled();
    core.clock.set(SEND_TIME);

    await pass();
    const sent = await messaging.sendMessage(chief, { selector: { kind: 'ship', name: 'scout' }, payload: 'Thanks', model: SESSION_MODEL, idempotencyKey: newKey() });

    expect(sent).toMatchObject({ isOk: false, error: { kind: 'MESSAGE_LIMIT_REACHED' } });
  });

  it('rolls back a send that fails mid-transaction: no message, no event, the send time not advanced; the next pass sends it once', async () => {
    const scheduleId = await scheduled();
    core.clock.set(SEND_TIME);
    const before = structuredClone(core.state.schedules);
    const eventCount = core.state.events.length;
    const failing: UnitOfWork<InMemoryTx> = {
      run: (work) =>
        core.uow.run((tx) =>
          work({
            ...tx,
            schedules: {
              ...tx.schedules,
              save: () => Promise.reject(new Error('the server died before commit')),
            },
          }),
        ),
    };
    const failingPass = createSendDueSchedules({ fleets: core.fleets, scheduleAttempts: core.scheduleAttempts, uow: failing, clock: core.clock, ids: core.ids, hasher: core.hasher });
    const errors: unknown[] = [];

    await failingPass((_fleetId, error) => errors.push(error));

    expect(errors).toHaveLength(1);
    expect([core.state.messages, core.state.deliveries, core.state.notices]).toEqual([[], [], []]);
    expect(core.state.events).toHaveLength(eventCount);
    expect(core.state.schedules).toEqual(before);

    await pass();

    expect(core.state.messages).toEqual([expect.objectContaining({ scheduleId })]);
  });
});

describe('a refused send time', () => {
  it('under skip, records the refusal with its code and send time, writes ScheduledSendRefused, and ends the once schedule', async () => {
    const scheduleId = await scheduled();
    await onlyChiefSends();
    core.clock.set(SEND_TIME);
    core.state.events.length = 0;

    await pass();

    expect(core.state.messages).toEqual([]);
    expect(scheduleOf(scheduleId)).toMatchObject({
      state: 'ended',
      nextSendTime: null,
      lastOutcome: { kind: 'refused', code: 'NOT_REACHABLE', sendTime: new Date(SEND_TIME), at: new Date(SEND_TIME) },
    });
    expect(core.state.events.map((event) => [event.type, event.shipId, event.details])).toEqual([
      ['ScheduledSendRefused', scout.shipId, { scheduleId, sendTime: SEND_TIME, code: 'NOT_REACHABLE', strategy: 'skip' }],
      ['ScheduleEnded', scout.shipId, { scheduleId, outcome: 'skipped' }],
    ]);
  });

  it('checks reach at the send time, storing the refusal record as a refused send does', async () => {
    await scheduled();
    await onlyChiefSends();
    core.state.reachRefusals.length = 0;
    core.clock.set(SEND_TIME);

    await pass();

    expect(core.state.reachRefusals).toHaveLength(1);
  });

  it('is refused when the recipient retired since', async () => {
    const scheduleId = await scheduled();
    unwrap(await registry.retireShip(argo, { shipId: chief.shipId }));
    core.clock.set(SEND_TIME);

    await pass();

    expect(scheduleOf(scheduleId)?.lastOutcome).toMatchObject({ kind: 'refused', code: 'UNRESOLVABLE_SELECTOR' });
  });

  it('is refused FORBIDDEN when a scope the send needs is gone', async () => {
    const scheduleId = await scheduled(aSchedule({ isForced: true }));
    unwrap(await registry.grantScopes(argo, { shipId: scout.shipId, grant: [], revoke: ['messages:force'] }));
    core.clock.set(SEND_TIME);

    await pass();

    expect(core.state.messages).toEqual([]);
    expect(scheduleOf(scheduleId)?.lastOutcome).toMatchObject({ kind: 'refused', code: 'FORBIDDEN' });
  });

  it('is refused at the daily message limit', async () => {
    withInstallationSettings(core, { defaultDailyMessageLimit: 1 });
    const scheduleId = await scheduled();
    unwrap(await messaging.sendMessage(chief, { selector: { kind: 'ship', name: 'scout' }, payload: 'Busy day', model: SESSION_MODEL, idempotencyKey: newKey() }));
    core.clock.set(SEND_TIME);

    await pass();

    expect(scheduleOf(scheduleId)?.lastOutcome).toMatchObject({ kind: 'refused', code: 'MESSAGE_LIMIT_REACHED' });
  });

  it('under retry, keeps the send time and tries again a pass later, then sends it with its own send time once allowed', async () => {
    const scheduleId = await scheduled(aSchedule({ onRefused: 'retry' }));
    await onlyChiefSends();
    core.clock.set(SEND_TIME);

    await expect(pass()).resolves.toEqual({ nextAttemptAt: new Date('2026-10-25T10:00:30.000Z') });
    expect(scheduleOf(scheduleId)).toMatchObject({ state: 'active', nextSendTime: new Date(SEND_TIME), nextAttemptAt: new Date('2026-10-25T10:00:30.000Z'), lastOutcome: { kind: 'refused' } });
    expect(core.state.scheduleNotices.at(-1)).toEqual({ fleetId, scheduleId, attemptAt: new Date('2026-10-25T10:00:30.000Z') });

    await pass();
    expect(core.state.messages).toEqual([]);

    await everyoneSends();
    core.clock.set('2026-10-25T10:00:30.000Z');
    await pass();

    expect(core.state.messages).toEqual([expect.objectContaining({ scheduleId, sendTime: new Date(SEND_TIME) })]);
    expect(scheduleOf(scheduleId)).toMatchObject({ state: 'ended', lastOutcome: { kind: 'sent' } });
  });

  it('under retry, tries once per pass, however often it is refused', async () => {
    const scheduleId = await scheduled(aSchedule({ onRefused: 'retry' }));
    await onlyChiefSends();
    core.clock.set(SEND_TIME);
    core.state.events.length = 0;

    await pass();

    expect(core.state.events.filter((event) => event.type === 'ScheduledSendRefused')).toHaveLength(1);
    expect(scheduleOf(scheduleId)?.state).toBe('active');
  });

  it('under retry, skips once its retry window ended', async () => {
    const scheduleId = await scheduled(aSchedule({ onRefused: 'retry', retryWindow: 'PT10M' }));
    await onlyChiefSends();
    core.clock.set('2026-10-25T10:09:59.999Z');
    await pass();
    expect(scheduleOf(scheduleId)?.state).toBe('active');

    // Its next try, a pass later, comes after the window.
    core.clock.set('2026-10-25T10:10:30.000Z');
    await pass();

    expect(scheduleOf(scheduleId)).toMatchObject({ state: 'ended', nextSendTime: null, nextAttemptAt: null });
  });

  it('under pause, records it, pauses the schedule with SchedulePaused, and sends nothing after', async () => {
    const scheduleId = await scheduled(aSchedule({ onRefused: 'pause' }));
    await onlyChiefSends();
    core.clock.set(SEND_TIME);
    core.state.events.length = 0;

    await pass();
    await everyoneSends();
    core.clock.advance(60 * 60_000);
    await pass();

    expect(core.state.messages).toEqual([]);
    expect(scheduleOf(scheduleId)).toMatchObject({ state: 'paused', nextSendTime: new Date(SEND_TIME), nextAttemptAt: null, lastOutcome: { kind: 'refused', code: 'NOT_REACHABLE' } });
    expect(core.state.events.filter((event) => event.shipId === scout.shipId).map((event) => event.type)).toEqual(['ScheduledSendRefused', 'SchedulePaused']);
  });
});
