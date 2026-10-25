import type { ScheduleId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import type { MessageToSchedule } from './schedule-message.js';

/**
 * Resuming a schedule (decision 0062, S10): scout's hourly check-in to
 * chief, made at 09:00 and paused at 09:01. Only its ship resumes it; the
 * send times passed while paused are skipped.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let argo: ShipCaller;
let scout: ShipCaller;
let manager: ShipCaller;
let scheduleId: ScheduleId;

function aSchedule(overrides: Partial<MessageToSchedule> = {}): MessageToSchedule {
  return { selector: { kind: 'ship', name: 'chief' }, payload: 'Check in', model: SESSION_MODEL, idempotencyKey: newKey(), timing: { kind: 'every', every: 'PT1H' }, ...overrides };
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-25T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: [] });
  manager = await shipWithScopes({ registry, argo }, { name: 'manager', type: 'manager', scopes: ['fleet:manage'] });
  ({ scheduleId } = unwrap(await messaging.scheduleMessage(scout, aSchedule())));
  core.clock.advance(60_000);
  unwrap(await messaging.pauseSchedule(scout, { scheduleId }));
  core.state.events.length = 0;
  core.state.scheduleNotices.length = 0;
});

describe('resuming a schedule', () => {
  it('lets its ship resume it before its next send time: active, that send time kept, with ScheduleResumed, telling the servers', async () => {
    await expect(messaging.resumeSchedule(scout, { scheduleId })).resolves.toEqual({ isOk: true, value: { scheduleId, state: 'active' } });

    expect(core.state.schedules[0]).toMatchObject({ state: 'active', nextSendTime: new Date('2026-10-25T10:00:00.000Z'), nextAttemptAt: new Date('2026-10-25T10:00:00.000Z') });
    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'ScheduleResumed', shipId: scout.shipId, actor: { kind: 'ship', shipId: scout.shipId }, details: { scheduleId, nextSendTime: '2026-10-25T10:00:00.000Z' } }),
    ]);
    expect(core.state.scheduleNotices).toEqual([expect.objectContaining({ scheduleId, attemptAt: new Date('2026-10-25T10:00:00.000Z') })]);
  });

  it('skips the send times passed while paused, sending none and recording none', async () => {
    core.clock.set('2026-10-25T12:30:00.000Z');

    unwrap(await messaging.resumeSchedule(scout, { scheduleId }));
    await messaging.sendDueSchedules();

    expect(core.state.schedules[0]).toMatchObject({ state: 'active', nextSendTime: new Date('2026-10-25T13:00:00.000Z') });
    expect(core.state.messages).toEqual([]);
    expect(core.state.events.map((event) => event.type)).toEqual(['ScheduleResumed']);
  });

  it('ends a once schedule resumed after its send time, sending nothing', async () => {
    const once = unwrap(await messaging.scheduleMessage(scout, aSchedule({ timing: { kind: 'once', at: new Date('2026-10-25T10:00:00.000Z') } })));
    unwrap(await messaging.pauseSchedule(scout, once));
    core.clock.set('2026-10-25T10:30:00.000Z');
    core.state.events.length = 0;

    await expect(messaging.resumeSchedule(scout, once)).resolves.toEqual({ isOk: true, value: { ...once, state: 'ended' } });

    expect(core.state.events.map((event) => [event.type, event.details])).toEqual([
      ['ScheduleResumed', { scheduleId: once.scheduleId }],
      ['ScheduleEnded', { scheduleId: once.scheduleId, outcome: 'skipped' }],
    ]);
  });

  it('resumes one its pause strategy paused, on the next send time after now', async () => {
    const paused = unwrap(await messaging.scheduleMessage(scout, aSchedule({ onRefused: 'pause' }))).scheduleId;
    const networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
    unwrap(await registry.defineLabel(argo, { key: 'role', values: ['chief'] }));
    await applyNetworkRules(registry, { by: networking, rules: [{ verb: 'send', from: [valueIdOf(core, { key: 'role', value: 'chief' })], to: [] }] });
    core.clock.set('2026-10-25T10:01:00.000Z');
    await messaging.sendDueSchedules();
    core.clock.set('2026-10-25T10:30:00.000Z');

    unwrap(await messaging.resumeSchedule(scout, { scheduleId: paused }));

    expect(core.state.events.filter((event) => event.type === 'SchedulePaused').map((event) => event.details)).toEqual([{ scheduleId: paused, reason: 'refused' }]);
    expect(core.state.schedules.find((schedule) => schedule.id === paused)).toMatchObject({ state: 'active', nextSendTime: new Date('2026-10-25T11:01:00.000Z') });
  });

  it('answers an active schedule active again, changing nothing', async () => {
    unwrap(await messaging.resumeSchedule(scout, { scheduleId }));

    await expect(messaging.resumeSchedule(scout, { scheduleId })).resolves.toEqual({ isOk: true, value: { scheduleId, state: 'active' } });
    expect(core.state.events).toHaveLength(1);
  });

  it('refuses a manager, as only its ship resumes it', async () => {
    expect(refusalOf(await messaging.resumeSchedule(manager, { scheduleId })).kind).toBe('SCHEDULE_NOT_FOUND');
    expect(core.state.schedules[0]?.state).toBe('paused');
  });

  it('refuses to resume a cancelled schedule', async () => {
    unwrap(await messaging.cancelSchedule(scout, { scheduleId }));

    expect(refusalOf(await messaging.resumeSchedule(scout, { scheduleId })).kind).toBe('SCHEDULE_CANCELLED');
  });
});
