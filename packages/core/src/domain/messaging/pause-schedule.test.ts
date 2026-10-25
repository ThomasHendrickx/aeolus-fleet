import type { ScheduleId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, everyShipMay, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

/**
 * Pausing a schedule (decision 0062, S10): scout's hourly check-in to chief,
 * made at 09:00. Its ship pauses its own; a manager with fleet:manage within
 * manage reach pauses any; nobody else sees it.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let argo: ShipCaller;
let scout: ShipCaller;
let chief: ShipCaller;
let manager: ShipCaller;
let scheduleId: ScheduleId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-25T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  chief = await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: [] });
  manager = await shipWithScopes({ registry, argo }, { name: 'manager', type: 'manager', scopes: ['fleet:manage'] });
  ({ scheduleId } = unwrap(
    await messaging.scheduleMessage(scout, { selector: { kind: 'ship', name: 'chief' }, payload: 'Check in', model: SESSION_MODEL, idempotencyKey: newKey(), timing: { kind: 'every', every: 'PT1H' } }),
  ));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

describe('pausing a schedule', () => {
  it('lets its ship pause it: paused, keeping its next send time, with SchedulePaused caused by it', async () => {
    await expect(messaging.pauseSchedule(scout, { scheduleId })).resolves.toEqual({ isOk: true, value: { scheduleId, state: 'paused' } });

    expect(core.state.schedules[0]).toMatchObject({ state: 'paused', nextSendTime: new Date('2026-10-25T10:00:00.000Z'), nextAttemptAt: null });
    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'SchedulePaused', shipId: scout.shipId, actor: { kind: 'ship', shipId: scout.shipId }, details: { scheduleId, reason: 'ship' } }),
    ]);
  });

  it('sends nothing while paused', async () => {
    unwrap(await messaging.pauseSchedule(scout, { scheduleId }));
    core.clock.set('2026-10-25T12:00:00.000Z');

    await messaging.sendDueSchedules();

    expect(core.state.messages).toEqual([]);
  });

  it('lets a manager with fleet:manage pause it, naming the manager', async () => {
    unwrap(await messaging.pauseSchedule(manager, { scheduleId }));

    expect(core.state.events).toEqual([expect.objectContaining({ type: 'SchedulePaused', actor: { kind: 'ship', shipId: manager.shipId }, details: { scheduleId, reason: 'manager' } })]);
  });

  it('lets argo pause any', async () => {
    unwrap(await messaging.pauseSchedule(argo, { scheduleId }));

    expect(core.state.schedules[0]?.state).toBe('paused');
  });

  it('refuses another ship without fleet:manage as if there were no such schedule, changing nothing', async () => {
    expect(refusalOf(await messaging.pauseSchedule(chief, { scheduleId })).kind).toBe('SCHEDULE_NOT_FOUND');
    expect(core.state.schedules[0]?.state).toBe('active');
  });

  it('refuses a manager outside its manage reach, storing only the refusal record', async () => {
    const networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
    unwrap(await registry.defineLabel(argo, { key: 'team', values: ['a'] }));
    unwrap(await registry.assignLabel(argo, { shipId: manager.shipId, valueId: valueIdOf(core, { key: 'team', value: 'a' }) }));
    await applyNetworkRules(registry, { by: networking, rules: [{ verb: 'manage', from: [valueIdOf(core, { key: 'team', value: 'a' })], to: [valueIdOf(core, { key: 'team', value: 'a' })] }, everyShipMay('send'), everyShipMay('read')] });
    core.state.reachRefusals.length = 0;

    expect(refusalOf(await messaging.pauseSchedule(manager, { scheduleId })).kind).toBe('NOT_REACHABLE');
    expect(core.state.reachRefusals).toHaveLength(1);
    expect(core.state.schedules[0]?.state).toBe('active');
  });

  it('answers a paused schedule paused again, changing nothing', async () => {
    unwrap(await messaging.pauseSchedule(scout, { scheduleId }));

    await expect(messaging.pauseSchedule(scout, { scheduleId })).resolves.toEqual({ isOk: true, value: { scheduleId, state: 'paused' } });
    expect(core.state.events).toHaveLength(1);
  });

  it('refuses to pause a cancelled schedule', async () => {
    unwrap(await messaging.cancelSchedule(scout, { scheduleId }));

    expect(refusalOf(await messaging.pauseSchedule(scout, { scheduleId })).kind).toBe('SCHEDULE_CANCELLED');
  });

  it('refuses to pause an ended schedule', async () => {
    const once = unwrap(
      await messaging.scheduleMessage(scout, { selector: { kind: 'ship', name: 'chief' }, payload: 'Once', model: SESSION_MODEL, idempotencyKey: newKey(), timing: { kind: 'once', at: new Date('2026-10-25T09:30:00.000Z') } }),
    );
    core.clock.set('2026-10-25T09:30:00.000Z');
    await messaging.sendDueSchedules();

    expect(refusalOf(await messaging.pauseSchedule(scout, once)).kind).toBe('SCHEDULE_ENDED');
  });
});
