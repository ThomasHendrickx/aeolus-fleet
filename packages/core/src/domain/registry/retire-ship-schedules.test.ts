import type { ScheduleId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

/**
 * Retiring a ship that holds schedules (decision 0062, S11): scout has a
 * check-in to chief at 10:00, one at 09:40 its refusal paused, chief retired by then, and one
 * at 09:30 already sent; argo retires scout at 09:45.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let argo: ShipCaller;
let scout: ShipCaller;
let active: ScheduleId;
let paused: ScheduleId;
let sent: ScheduleId;

async function scheduledAt(at: string, onRefused: 'skip' | 'pause' = 'skip'): Promise<ScheduleId> {
  return unwrap(
    await messaging.scheduleMessage(scout, { selector: { kind: 'ship', name: 'chief' }, payload: 'Check in', model: SESSION_MODEL, idempotencyKey: newKey(), timing: { kind: 'once', at: new Date(at) }, onRefused }),
  ).scheduleId;
}

function stateOf(scheduleId: ScheduleId) {
  return core.state.schedules.find(({ id }) => id === scheduleId)?.state;
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-25T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  const chief = await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: [] });
  sent = await scheduledAt('2026-10-25T09:30:00.000Z');
  active = await scheduledAt('2026-10-25T10:00:00.000Z');
  paused = await scheduledAt('2026-10-25T09:40:00.000Z', 'pause');
  core.clock.set('2026-10-25T09:30:00.000Z');
  await messaging.sendDueSchedules();
  // chief is away: the 09:40 send is refused, which pauses its schedule.
  unwrap(await registry.retireShip(argo, { shipId: chief.shipId }));
  core.clock.set('2026-10-25T09:40:00.000Z');
  await messaging.sendDueSchedules();
  core.clock.set('2026-10-25T09:45:00.000Z');
  core.state.events.length = 0;
});

describe('retiring a ship with schedules', () => {
  it('cancels its active and paused schedules in the same unit of work, leaving the ended one', async () => {
    unwrap(await registry.retireShip(argo, { shipId: scout.shipId }));

    expect([stateOf(active), stateOf(paused), stateOf(sent)]).toEqual(['cancelled', 'cancelled', 'ended']);
  });

  it('writes ScheduleCancelled for each, on the retired ship, with the reason retired, caused by the retirer', async () => {
    unwrap(await registry.retireShip(argo, { shipId: scout.shipId }));

    expect(core.state.events.filter(({ type }) => type === 'ScheduleCancelled')).toEqual([
      expect.objectContaining({ shipId: scout.shipId, actor: { kind: 'ship', shipId: argo.shipId }, details: { scheduleId: active, reason: 'retired' } }),
      expect.objectContaining({ shipId: scout.shipId, actor: { kind: 'ship', shipId: argo.shipId }, details: { scheduleId: paused, reason: 'retired' } }),
    ]);
  });

  it('sends nothing for them after', async () => {
    unwrap(await registry.retireShip(argo, { shipId: scout.shipId }));
    const messages = core.state.messages.length;
    core.clock.set('2026-10-25T10:00:00.000Z');

    await messaging.sendDueSchedules();

    expect(core.state.messages).toHaveLength(messages);
  });
});
