import type { ScheduleId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import type { MessageToSchedule } from './schedule-message.js';

/**
 * A repeating schedule's send times (decision 0062, S1, S2 and S6): scout
 * checks in with chief every hour, made at 09:00, so it sends at 10:00,
 * 11:00 and on. Each pass is one call of the use case.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let argo: ShipCaller;
let scout: ShipCaller;
let chief: ShipCaller;
let networking: ShipCaller;

function hourly(overrides: Partial<MessageToSchedule> = {}): MessageToSchedule {
  return {
    selector: { kind: 'ship', name: 'chief' },
    payload: 'Check in: what changed in the last hour?',
    model: SESSION_MODEL,
    idempotencyKey: newKey(),
    timing: { kind: 'every', every: 'PT1H' },
    ...overrides,
  };
}

async function scheduled(input: MessageToSchedule = hourly()): Promise<ScheduleId> {
  return unwrap(await messaging.scheduleMessage(scout, input)).scheduleId;
}

function scheduleOf(scheduleId: ScheduleId) {
  return core.state.schedules.find((schedule) => schedule.id === scheduleId);
}

function sendTimes(): (string | undefined)[] {
  return core.state.messages.map((message) => message.sendTime?.toISOString());
}

async function passAt(instant: string): Promise<void> {
  core.clock.set(instant);
  await messaging.sendDueSchedules();
}

function eventsOf(type: string) {
  return core.state.events.filter((event) => event.type === type).map((event) => event.details);
}

/** Lets only the ships labelled role=chief send: scout reaches nobody then. */
async function onlyChiefSends(): Promise<void> {
  unwrap(await registry.defineLabel(argo, { key: 'role', values: ['chief'] }));
  unwrap(await registry.assignLabel(argo, { shipId: chief.shipId, valueId: valueIdOf(core, { key: 'role', value: 'chief' }) }));
  await applyNetworkRules(registry, { by: networking, rules: [{ verb: 'send', from: [valueIdOf(core, { key: 'role', value: 'chief' })], to: [] }] });
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-25T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  chief = await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: [] });
  networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
});

describe('a repeating send time', () => {
  it('sends one message at each send time, stamped with it, and goes on to the next', async () => {
    const scheduleId = await scheduled();

    await passAt('2026-10-25T10:00:00.000Z');
    await passAt('2026-10-25T10:30:00.000Z');
    await passAt('2026-10-25T11:00:01.000Z');

    expect(sendTimes()).toEqual(['2026-10-25T10:00:00.000Z', '2026-10-25T11:00:00.000Z']);
    expect(core.state.messages.map((message) => message.idempotencyKey)).toEqual([`schedule:${scheduleId}:2026-10-25T10:00:00.000Z`, `schedule:${scheduleId}:2026-10-25T11:00:00.000Z`]);
    expect(scheduleOf(scheduleId)).toMatchObject({
      state: 'active',
      nextSendTime: new Date('2026-10-25T12:00:00.000Z'),
      nextAttemptAt: new Date('2026-10-25T12:00:00.000Z'),
      lastOutcome: { kind: 'sent', sendTime: new Date('2026-10-25T11:00:00.000Z') },
    });
    expect(eventsOf('ScheduleEnded')).toEqual([]);
  });

  it('tells the servers of its next send time', async () => {
    const scheduleId = await scheduled();
    core.state.scheduleNotices.length = 0;

    await passAt('2026-10-25T10:00:00.000Z');

    expect(core.state.scheduleNotices).toEqual([expect.objectContaining({ scheduleId, attemptAt: new Date('2026-10-25T11:00:00.000Z') })]);
  });

  it('ends after its count of sends, with ScheduleEnded', async () => {
    const scheduleId = await scheduled(hourly({ timing: { kind: 'every', every: 'PT1H', count: 2 } }));

    await passAt('2026-10-25T10:00:00.000Z');
    await passAt('2026-10-25T11:00:00.000Z');
    await passAt('2026-10-25T12:00:00.000Z');

    expect(sendTimes()).toEqual(['2026-10-25T10:00:00.000Z', '2026-10-25T11:00:00.000Z']);
    expect(scheduleOf(scheduleId)).toMatchObject({ state: 'ended', nextSendTime: null, nextAttemptAt: null, endedAt: new Date('2026-10-25T11:00:00.000Z') });
    expect(eventsOf('ScheduleEnded')).toEqual([{ scheduleId, outcome: 'sent' }]);
  });

  it('counts sends only: a refused send time leaves the count to the next', async () => {
    const scheduleId = await scheduled(hourly({ timing: { kind: 'every', every: 'PT1H', count: 1 } }));
    await onlyChiefSends();
    await passAt('2026-10-25T10:00:00.000Z');
    await applyNetworkRules(registry, { by: networking, rules: null });

    await passAt('2026-10-25T11:00:00.000Z');

    expect(sendTimes()).toEqual(['2026-10-25T11:00:00.000Z']);
    expect(scheduleOf(scheduleId)?.state).toBe('ended');
  });

  it('ends after its last send time at or before its end', async () => {
    const scheduleId = await scheduled(hourly({ timing: { kind: 'every', every: 'PT1H', end: new Date('2026-10-25T11:00:00.000Z') } }));

    await passAt('2026-10-25T10:00:00.000Z');
    await passAt('2026-10-25T11:00:00.000Z');

    expect(sendTimes()).toEqual(['2026-10-25T10:00:00.000Z', '2026-10-25T11:00:00.000Z']);
    expect(scheduleOf(scheduleId)).toMatchObject({ state: 'ended', nextSendTime: null });
  });

  it('goes on to the next send time after a refused one it skips, rather than ending', async () => {
    const scheduleId = await scheduled();
    await onlyChiefSends();

    await passAt('2026-10-25T10:00:00.000Z');

    expect(scheduleOf(scheduleId)).toMatchObject({
      state: 'active',
      nextSendTime: new Date('2026-10-25T11:00:00.000Z'),
      lastOutcome: { kind: 'refused', code: 'NOT_REACHABLE', sendTime: new Date('2026-10-25T10:00:00.000Z') },
    });
    expect(eventsOf('ScheduleEnded')).toEqual([]);
  });

  it('goes on to the next send time once a refused one leaves its retry window', async () => {
    const scheduleId = await scheduled(hourly({ onRefused: 'retry', retryWindow: 'PT10M' }));
    await onlyChiefSends();
    await passAt('2026-10-25T10:00:00.000Z');

    await passAt('2026-10-25T10:10:00.000Z');

    expect(scheduleOf(scheduleId)).toMatchObject({ state: 'active', nextSendTime: new Date('2026-10-25T11:00:00.000Z'), nextAttemptAt: new Date('2026-10-25T11:00:00.000Z') });
  });

  it('sends a cron wall time that summer time doubles once, at its first', async () => {
    core.clock.set('2026-10-24T12:00:00.000Z');
    const scheduleId = await scheduled(hourly({ timing: { kind: 'cron', cron: '30 2 * * *', timeZone: 'Europe/Brussels' } }));

    await passAt('2026-10-25T00:30:00.000Z');
    await passAt('2026-10-25T01:30:00.000Z');

    expect(sendTimes()).toEqual(['2026-10-25T00:30:00.000Z']);
    expect(scheduleOf(scheduleId)?.nextSendTime).toEqual(new Date('2026-10-26T01:30:00.000Z'));
  });

  it('sends a cron wall time that summer time skips at the first valid minute after it', async () => {
    core.clock.set('2027-03-27T12:00:00.000Z');
    await scheduled(hourly({ timing: { kind: 'cron', cron: '30 2 * * *', timeZone: 'Europe/Brussels' } }));

    await passAt('2027-03-28T01:00:00.000Z');

    expect(sendTimes()).toEqual(['2027-03-28T01:00:00.000Z']);
  });
});

describe('a missed send time', () => {
  it('is on time when the pass reaches it exactly at its grace, and missed a millisecond later', async () => {
    await scheduled(hourly({ onMissed: 'skip' }));
    await passAt('2026-10-25T10:05:00.000Z');

    await passAt('2026-10-25T11:05:00.001Z');

    expect(sendTimes()).toEqual(['2026-10-25T10:00:00.000Z']);
    expect(eventsOf('ScheduledSendMissed')).toEqual([expect.objectContaining({ sendTime: '2026-10-25T11:00:00.000Z' })]);
  });

  it('sends every missed one under each, oldest first, each stamped with its own send time', async () => {
    const scheduleId = await scheduled(hourly({ onMissed: 'each' }));

    await passAt('2026-10-25T13:30:00.000Z');

    expect(sendTimes()).toEqual(['2026-10-25T10:00:00.000Z', '2026-10-25T11:00:00.000Z', '2026-10-25T12:00:00.000Z', '2026-10-25T13:00:00.000Z']);
    expect(scheduleOf(scheduleId)).toMatchObject({ state: 'active', nextSendTime: new Date('2026-10-25T14:00:00.000Z'), nextAttemptAt: new Date('2026-10-25T14:00:00.000Z') });
    expect(eventsOf('ScheduledSendMissed')).toEqual([]);
  });

  it('catches up every missed one when the creator says nothing', async () => {
    await scheduled();

    await passAt('2026-10-25T12:30:00.000Z');

    expect(sendTimes()).toHaveLength(3);
  });

  it('sends only the latest missed one under once, recording the others as missed', async () => {
    const scheduleId = await scheduled(hourly({ onMissed: 'once' }));

    await passAt('2026-10-25T13:30:00.000Z');

    expect(sendTimes()).toEqual(['2026-10-25T13:00:00.000Z']);
    expect(eventsOf('ScheduledSendMissed')).toEqual(
      ['2026-10-25T10:00:00.000Z', '2026-10-25T11:00:00.000Z', '2026-10-25T12:00:00.000Z'].map((sendTime) => ({ scheduleId, sendTime, strategy: 'once' })),
    );
    expect(scheduleOf(scheduleId)?.nextSendTime).toEqual(new Date('2026-10-25T14:00:00.000Z'));
  });

  it('sends an on-time one after the missed under once: the latest missed and the one inside its grace', async () => {
    await scheduled(hourly({ timing: { kind: 'every', every: 'PT10M' }, onMissed: 'once' }));

    await passAt('2026-10-25T09:43:00.000Z');

    expect(sendTimes()).toEqual(['2026-10-25T09:30:00.000Z', '2026-10-25T09:40:00.000Z']);
  });

  it('sends none of the missed ones under skip, recording each with its send time, and waits for the next', async () => {
    const scheduleId = await scheduled(hourly({ onMissed: 'skip' }));

    await passAt('2026-10-25T12:30:00.000Z');

    expect(sendTimes()).toEqual([]);
    expect(eventsOf('ScheduledSendMissed')).toEqual(['2026-10-25T10:00:00.000Z', '2026-10-25T11:00:00.000Z', '2026-10-25T12:00:00.000Z'].map((sendTime) => ({ scheduleId, sendTime, strategy: 'skip' })));
    expect(scheduleOf(scheduleId)).toMatchObject({
      state: 'active',
      nextSendTime: new Date('2026-10-25T13:00:00.000Z'),
      lastOutcome: { kind: 'missed', sendTime: new Date('2026-10-25T12:00:00.000Z'), at: new Date('2026-10-25T12:30:00.000Z') },
    });
  });

  it('ends a once schedule missed under skip, sending nothing', async () => {
    const scheduleId = await scheduled(hourly({ timing: { kind: 'once', at: new Date('2026-10-25T10:00:00.000Z') }, onMissed: 'skip' }));

    await passAt('2026-10-25T11:00:00.000Z');

    expect(sendTimes()).toEqual([]);
    expect(scheduleOf(scheduleId)).toMatchObject({ state: 'ended', lastOutcome: { kind: 'missed' } });
    expect(eventsOf('ScheduleEnded')).toEqual([{ scheduleId, outcome: 'missed' }]);
  });

  it('never misses a send time it keeps for a retry, however late the retry', async () => {
    await scheduled(hourly({ onRefused: 'retry', retryWindow: 'PT30M', onMissed: 'skip' }));
    await onlyChiefSends();
    await passAt('2026-10-25T10:00:00.000Z');
    await applyNetworkRules(registry, { by: networking, rules: null });

    await passAt('2026-10-25T10:20:00.000Z');

    expect(sendTimes()).toEqual(['2026-10-25T10:00:00.000Z']);
    expect(eventsOf('ScheduledSendMissed')).toEqual([]);
  });

  it('handles at most 100 send times in a pass, oldest first, the rest on the next pass', async () => {
    const scheduleId = await scheduled(hourly({ timing: { kind: 'every', every: 'PT1M' } }));

    await passAt('2026-10-25T11:30:00.000Z');

    expect(sendTimes()).toHaveLength(100);
    expect(sendTimes().at(-1)).toBe('2026-10-25T10:40:00.000Z');
    expect(scheduleOf(scheduleId)).toMatchObject({ nextSendTime: new Date('2026-10-25T10:41:00.000Z'), nextAttemptAt: new Date('2026-10-25T10:41:00.000Z') });

    await passAt('2026-10-25T11:30:00.000Z');

    expect(sendTimes()).toHaveLength(150);
    expect(sendTimes().at(-1)).toBe('2026-10-25T11:30:00.000Z');
  });

  it('records at most 100 missed send times in a pass under skip', async () => {
    await scheduled(hourly({ timing: { kind: 'every', every: 'PT1M' }, onMissed: 'skip' }));

    await passAt('2026-10-25T11:30:00.000Z');

    expect(eventsOf('ScheduledSendMissed')).toHaveLength(100);
  });

  it('goes on with the next missed one after a refusal it skips, and stops at one it keeps for a retry', async () => {
    const skipping = await scheduled(hourly({ onRefused: 'skip' }));
    const retrying = await scheduled(hourly({ onRefused: 'retry', retryWindow: 'PT3H' }));
    await onlyChiefSends();

    await passAt('2026-10-25T12:30:00.000Z');

    expect(eventsOf('ScheduledSendRefused').map((details) => [details.scheduleId, details.sendTime])).toEqual([
      [skipping, '2026-10-25T10:00:00.000Z'],
      [skipping, '2026-10-25T11:00:00.000Z'],
      [skipping, '2026-10-25T12:00:00.000Z'],
      [retrying, '2026-10-25T10:00:00.000Z'],
    ]);
    expect(scheduleOf(retrying)?.nextSendTime).toEqual(new Date('2026-10-25T10:00:00.000Z'));
  });
});
