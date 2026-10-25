import type { ScheduleId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

/**
 * A ship's schedules (decision 0062): scout has three check-ins to chief, at
 * 10:00, 11:00 and 12:00, made in that order.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let argo: ShipCaller;
let scout: ShipCaller;
let chief: ShipCaller;
let manager: ShipCaller;
let tenOClock: ScheduleId;
let elevenOClock: ScheduleId;
let noon: ScheduleId;

async function scheduledAt(at: string): Promise<ScheduleId> {
  core.clock.advance(1);
  return unwrap(await messaging.scheduleMessage(scout, { selector: { kind: 'ship', name: 'chief' }, payload: 'Check in', model: SESSION_MODEL, idempotencyKey: newKey(), timing: { kind: 'once', at: new Date(at) } }))
    .scheduleId;
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-25T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  chief = await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: [] });
  manager = await shipWithScopes({ registry, argo }, { name: 'manager', type: 'manager', scopes: ['fleet:manage'] });
  tenOClock = await scheduledAt('2026-10-25T10:00:00.000Z');
  elevenOClock = await scheduledAt('2026-10-25T11:00:00.000Z');
  noon = await scheduledAt('2026-10-25T12:00:00.000Z');
});

function idsOf(page: { items: { id: ScheduleId }[] }): ScheduleId[] {
  return page.items.map((schedule) => schedule.id);
}

describe("listing a ship's schedules", () => {
  it('lists its own, newest first', async () => {
    const page = unwrap(await messaging.listSchedules(scout, { shipId: scout.shipId, limit: 20 }));

    expect(idsOf(page)).toEqual([noon, elevenOClock, tenOClock]);
    expect(page.nextCursor).toBeNull();
  });

  it('pages by cursor', async () => {
    const first = unwrap(await messaging.listSchedules(scout, { shipId: scout.shipId, limit: 2 }));
    const second = unwrap(await messaging.listSchedules(scout, { shipId: scout.shipId, limit: 2, cursor: first.nextCursor ?? undefined }));

    expect([idsOf(first), first.nextCursor, idsOf(second), second.nextCursor]).toEqual([[noon, elevenOClock], elevenOClock, [tenOClock], null]);
  });

  it('lists active and paused ones by default, and the ended and cancelled ones a state filter asks for', async () => {
    unwrap(await messaging.cancelSchedule(scout, { scheduleId: noon }));
    core.clock.set('2026-10-25T10:00:00.000Z');
    await messaging.sendDueSchedules();

    const open = unwrap(await messaging.listSchedules(scout, { shipId: scout.shipId, limit: 20 }));
    const closed = unwrap(await messaging.listSchedules(scout, { shipId: scout.shipId, limit: 20, states: ['ended', 'cancelled'] }));

    expect([idsOf(open), idsOf(closed)]).toEqual([[elevenOClock], [noon, tenOClock]]);
    expect(closed.items.find((schedule) => schedule.id === tenOClock)?.lastOutcome).toMatchObject({ kind: 'sent' });
  });

  it("lets a manager with fleet:manage list another ship's schedules", async () => {
    expect(idsOf(unwrap(await messaging.listSchedules(manager, { shipId: scout.shipId, limit: 20 })))).toEqual([noon, elevenOClock, tenOClock]);
  });

  it('refuses another ship without fleet:manage', async () => {
    expect(refusalOf(await messaging.listSchedules(chief, { shipId: scout.shipId, limit: 20 })).kind).toBe('FORBIDDEN');
  });

  it('answers no schedules for a ship that has none', async () => {
    expect(unwrap(await messaging.listSchedules(chief, { shipId: chief.shipId, limit: 20 }))).toEqual({ items: [], nextCursor: null });
  });
});
