import { createIdGenerator, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { aCrewSettings, shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { wholeShips } from '../../../test/support/ships.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import { newKey } from '../../testing/keys.js';

// The assigned trierarch writes the activity of the crewed ships it runs
// (docs/design/monitoring, 4.3): each entry only for a ship whose crew
// request is assigned to it, any other refused for that entry, the rest taken.

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let plugin: ShipCaller;
let trierarch: ShipCaller;
let scoutId: ShipId;
let writerId: ShipId;

async function assignedAndCrewed(name: string): Promise<ShipId> {
  const { shipId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }));
  unwrap(await registry.requestCrew(argo, { shipId, settings: aCrewSettings({ harness: 'claude-code' }) }));
  unwrap(await registry.assignCrew(plugin, { shipId, trierarchShipId: trierarch.shipId }));
  crewAboard(core, { fleetId, shipId });
  return shipId;
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-31T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] });
  trierarch = await shipWithScopes({ registry, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
  scoutId = await assignedAndCrewed('scout');
  writerId = await assignedAndCrewed('writer');
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

async function activityOf(shipId: ShipId) {
  return wholeShips((await registry.listFleet(argo)).ships).find((ship) => ship.id === shipId)?.activity;
}

describe("the assigned trierarch's activity", () => {
  it('is taken for each crewed ship it runs, with when it was written and the interval it states, and shown with the ship', async () => {
    const written = await registry.reportActivity(trierarch, {
      intervalSeconds: 30,
      activities: [
        { shipId: scoutId, at: '2026-10-31T08:59:50.000Z', kind: 'tool', tool: 'Bash' },
        { shipId: writerId, at: '2026-10-31T08:59:40.000Z', kind: 'text' },
      ],
    });

    expect(written).toEqual({ isOk: true, value: { refused: [] } });
    await expect(activityOf(scoutId)).resolves.toEqual({
      at: new Date('2026-10-31T08:59:50.000Z'),
      kind: 'tool',
      tool: 'Bash',
      reportedAt: new Date('2026-10-31T09:01:00.000Z'),
      intervalSeconds: 30,
    });
    await expect(activityOf(writerId)).resolves.toEqual({
      at: new Date('2026-10-31T08:59:40.000Z'),
      kind: 'text',
      tool: null,
      reportedAt: new Date('2026-10-31T09:01:00.000Z'),
      intervalSeconds: 30,
    });
    await expect(registry.getShip(argo, { shipId: scoutId })).resolves.toMatchObject({ isOk: true, value: { activity: { kind: 'tool', tool: 'Bash' } } });
  });

  it('replaces what the ship held with the latest write', async () => {
    unwrap(await registry.reportActivity(trierarch, { intervalSeconds: 30, activities: [{ shipId: scoutId, at: '2026-10-31T08:59:50.000Z', kind: 'tool', tool: 'Bash' }] }));
    core.clock.advance(30_000);

    unwrap(await registry.reportActivity(trierarch, { intervalSeconds: 60, activities: [{ shipId: scoutId, at: '2026-10-31T09:01:20.000Z', kind: 'result' }] }));

    await expect(activityOf(scoutId)).resolves.toEqual({
      at: new Date('2026-10-31T09:01:20.000Z'),
      kind: 'result',
      tool: null,
      reportedAt: new Date('2026-10-31T09:01:30.000Z'),
      intervalSeconds: 60,
    });
  });

  it('writes no event: a session activity is not a fleet change', async () => {
    unwrap(await registry.reportActivity(trierarch, { intervalSeconds: 30, activities: [{ shipId: scoutId, at: '2026-10-31T08:59:50.000Z', kind: 'error' }] }));

    expect(core.state.events).toEqual([]);
  });

  it('is none for a ship before its trierarch writes any', async () => {
    await expect(activityOf(scoutId)).resolves.toBeNull();
  });

  it("goes with the lease: the ship's next crew starts with none", async () => {
    unwrap(await registry.reportActivity(trierarch, { intervalSeconds: 30, activities: [{ shipId: scoutId, at: '2026-10-31T08:59:50.000Z', kind: 'tool' }] }));
    unwrap(await registry.releaseShip(trierarch, { shipId: scoutId }));

    crewAboard(core, { fleetId, shipId: scoutId });

    await expect(activityOf(scoutId)).resolves.toBeNull();
  });
});

describe('an activity refused for its entry, the rest taken', () => {
  it('refuses an unassigned ship and takes the rest', async () => {
    const { shipId: strayId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'stray', type: 'reviewer' }));
    unwrap(await registry.requestCrew(argo, { shipId: strayId, settings: aCrewSettings({ harness: 'claude-code' }) }));
    crewAboard(core, { fleetId, shipId: strayId });

    const written = unwrap(
      await registry.reportActivity(trierarch, {
        intervalSeconds: 30,
        activities: [
          { shipId: strayId, at: '2026-10-31T08:59:50.000Z', kind: 'tool' },
          { shipId: scoutId, at: '2026-10-31T08:59:50.000Z', kind: 'tool' },
        ],
      }),
    );

    expect(written.refused.map(({ shipId, error }) => ({ shipId, kind: error.kind }))).toEqual([{ shipId: strayId, kind: 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER' }]);
    await expect(activityOf(strayId)).resolves.toBeNull();
    await expect(activityOf(scoutId)).resolves.toMatchObject({ kind: 'tool' });
  });

  it('refuses a ship assigned to another trierarch', async () => {
    const other = await shipWithScopes({ registry, argo }, { name: 'linux-box', type: 'trierarch', scopes: ['crew:run'] });

    const written = unwrap(await registry.reportActivity(other, { intervalSeconds: 30, activities: [{ shipId: scoutId, at: '2026-10-31T08:59:50.000Z', kind: 'tool' }] }));

    expect(written.refused.map(({ shipId, error }) => ({ shipId, kind: error.kind }))).toEqual([{ shipId: scoutId, kind: 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER' }]);
    await expect(activityOf(scoutId)).resolves.toBeNull();
  });

  it('refuses a ship without a crew request', async () => {
    const { shipId: handCrewedId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'hand-crewed', type: 'reviewer' }));
    crewAboard(core, { fleetId, shipId: handCrewedId });

    const written = unwrap(await registry.reportActivity(trierarch, { intervalSeconds: 30, activities: [{ shipId: handCrewedId, at: '2026-10-31T08:59:50.000Z', kind: 'tool' }] }));

    expect(written.refused.map(({ shipId, error }) => ({ shipId, kind: error.kind }))).toEqual([{ shipId: handCrewedId, kind: 'CREW_REQUEST_NOT_FOUND' }]);
  });

  it('refuses an assigned ship no session crews yet', async () => {
    const { shipId: waitingId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'waiting', type: 'reviewer' }));
    unwrap(await registry.requestCrew(argo, { shipId: waitingId, settings: aCrewSettings({ harness: 'claude-code' }) }));
    unwrap(await registry.assignCrew(plugin, { shipId: waitingId, trierarchShipId: trierarch.shipId }));

    const written = unwrap(await registry.reportActivity(trierarch, { intervalSeconds: 30, activities: [{ shipId: waitingId, at: '2026-10-31T08:59:50.000Z', kind: 'tool' }] }));

    expect(written.refused.map(({ shipId, error }) => ({ shipId, kind: error.kind }))).toEqual([{ shipId: waitingId, kind: 'SHIP_NOT_CREWED' }]);
  });

  it('refuses a ship the fleet does not hold', async () => {
    const foreignId = createIdGenerator()('ship');

    const written = unwrap(await registry.reportActivity(trierarch, { intervalSeconds: 30, activities: [{ shipId: foreignId, at: '2026-10-31T08:59:50.000Z', kind: 'tool' }] }));

    expect(written.refused.map(({ shipId, error }) => ({ shipId, kind: error.kind }))).toEqual([{ shipId: foreignId, kind: 'SHIP_NOT_FOUND' }]);
  });
});
