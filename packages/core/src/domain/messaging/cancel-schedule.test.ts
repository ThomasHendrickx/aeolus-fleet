import type { FleetId, ScheduleId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, everyShipMay, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

/**
 * Cancelling a schedule (decision 0062): scout's check-in to chief, at
 * 10:00. Its ship cancels its own; a manager with fleet:manage within manage
 * reach cancels any; nobody else sees it.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let scout: ShipCaller;
let chief: ShipCaller;
let manager: ShipCaller;
let scheduleId: ScheduleId;

const SEND_TIME = '2026-10-25T10:00:00.000Z';

beforeEach(async () => {
  core = createInMemoryCore('2026-10-25T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  chief = await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: [] });
  manager = await shipWithScopes({ registry, argo }, { name: 'manager', type: 'manager', scopes: ['fleet:manage'] });
  ({ scheduleId } = unwrap(
    await messaging.scheduleMessage(scout, { selector: { kind: 'ship', name: 'chief' }, payload: 'Check in', model: SESSION_MODEL, idempotencyKey: newKey(), timing: { kind: 'once', at: new Date(SEND_TIME) } }),
  ));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

describe('cancelling a schedule', () => {
  it('lets its ship cancel it: cancelled, with no next send time, and ScheduleCancelled caused by it', async () => {
    await expect(messaging.cancelSchedule(scout, { scheduleId })).resolves.toEqual({ isOk: true, value: { scheduleId, state: 'cancelled' } });

    expect(core.state.schedules[0]).toMatchObject({ state: 'cancelled', nextSendTime: null, nextAttemptAt: null, cancelledAt: new Date('2026-10-25T09:01:00.000Z') });
    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'ScheduleCancelled', shipId: scout.shipId, actor: { kind: 'ship', shipId: scout.shipId }, details: { scheduleId, reason: 'ship' } }),
    ]);
  });

  it('lets a manager with fleet:manage cancel it, naming the manager', async () => {
    unwrap(await messaging.cancelSchedule(manager, { scheduleId }));

    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'ScheduleCancelled', shipId: scout.shipId, actor: { kind: 'ship', shipId: manager.shipId }, details: { scheduleId, reason: 'manager' } }),
    ]);
  });

  it('lets argo cancel any, the fail-safe for a schedule that misbehaves', async () => {
    unwrap(await messaging.cancelSchedule(argo, { scheduleId }));

    expect(core.state.schedules[0]?.state).toBe('cancelled');
  });

  it("refuses another ship without fleet:manage as if there were no such schedule, changing nothing", async () => {
    expect(refusalOf(await messaging.cancelSchedule(chief, { scheduleId })).kind).toBe('SCHEDULE_NOT_FOUND');
    expect(core.state.schedules[0]?.state).toBe('active');
  });

  it('refuses a manager outside its manage reach, storing only the refusal record', async () => {
    const networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
    unwrap(await registry.defineLabel(argo, { key: 'team', values: ['a'] }));
    unwrap(await registry.assignLabel(argo, { shipId: manager.shipId, valueId: valueIdOf(core, { key: 'team', value: 'a' }) }));
    await applyNetworkRules(registry, { by: networking, rules: [{ verb: 'manage', from: [valueIdOf(core, { key: 'team', value: 'a' })], to: [valueIdOf(core, { key: 'team', value: 'a' })] }, everyShipMay('send'), everyShipMay('read')] });
    core.state.reachRefusals.length = 0;

    expect(refusalOf(await messaging.cancelSchedule(manager, { scheduleId })).kind).toBe('NOT_REACHABLE');
    expect(core.state.reachRefusals).toHaveLength(1);
    expect(core.state.schedules[0]?.state).toBe('active');
  });

  it('answers a cancelled schedule cancelled again, changing nothing', async () => {
    unwrap(await messaging.cancelSchedule(scout, { scheduleId }));

    await expect(messaging.cancelSchedule(scout, { scheduleId })).resolves.toEqual({ isOk: true, value: { scheduleId, state: 'cancelled' } });
    expect(core.state.events).toHaveLength(1);
  });

  it('refuses to cancel an ended schedule', async () => {
    core.clock.set(SEND_TIME);
    await messaging.sendDueSchedules();

    expect(refusalOf(await messaging.cancelSchedule(scout, { scheduleId })).kind).toBe('SCHEDULE_ENDED');
  });

  it('refuses a schedule that does not exist, or of another fleet', async () => {
    expect(refusalOf(await messaging.cancelSchedule(scout, { scheduleId: core.ids('schedule') })).kind).toBe('SCHEDULE_NOT_FOUND');
    expect(core.state.schedules.every((schedule) => schedule.fleetId === fleetId)).toBe(true);
  });
});
