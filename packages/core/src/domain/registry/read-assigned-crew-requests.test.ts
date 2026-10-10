import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { newKey } from '../../../test/support/keys.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: Caller;
let plugin: Caller;
let trierarch: Caller;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-06T17:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] });
  trierarch = await shipWithScopes({ registry, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
});

async function requested(name: string): Promise<ShipId> {
  const { shipId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }));
  unwrap(await registry.requestCrew(argo, { shipId, settings: { harness: 'claude-code' } }));
  return shipId;
}

describe("a trierarch's assigned crew requests", () => {
  it('are the requests assigned to its ship, oldest ship first, with settings, status and whether their crew is final', async () => {
    const scoutId = await requested('scout');
    const lookoutId = await requested('lookout');
    await requested('unassigned');
    unwrap(await registry.assignCrew(plugin, { shipId: lookoutId, trierarchShipId: trierarch.shipId }));
    unwrap(await registry.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarch.shipId }));
    unwrap(await registry.reportCrewStatus(trierarch, { shipId: scoutId, status: 'running' }));

    await expect(registry.readAssignedCrewRequests(trierarch)).resolves.toEqual([
      { shipId: scoutId, settings: { harness: 'claude-code' }, settingsVersion: 1, requestedAt: core.clock.now(), status: 'running', isFinal: true },
      { shipId: lookoutId, settings: { harness: 'claude-code' }, settingsVersion: 1, requestedAt: core.clock.now(), status: null, isFinal: false },
    ]);
  });

  it('say a crew is final once its trierarch saw it working, whatever status it reported since (#477)', async () => {
    const scoutId = await requested('scout');
    unwrap(await registry.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarch.shipId }));
    unwrap(await registry.reportCrewStatus(trierarch, { shipId: scoutId, status: 'running' }));

    unwrap(await registry.reportCrewStatus(trierarch, { shipId: scoutId, status: 'crewing' }));

    await expect(registry.readAssignedCrewRequests(trierarch)).resolves.toMatchObject([{ shipId: scoutId, status: 'crewing', isFinal: true }]);
  });

  it('say a crew is not final once a new settings version is requested, until it runs again (#477)', async () => {
    const scoutId = await requested('scout');
    unwrap(await registry.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarch.shipId }));
    unwrap(await registry.reportCrewStatus(trierarch, { shipId: scoutId, status: 'running' }));

    unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings: { harness: 'codex' } }));

    await expect(registry.readAssignedCrewRequests(trierarch)).resolves.toMatchObject([{ shipId: scoutId, settingsVersion: 2, isFinal: false }]);
  });

  it('are none for a ship nothing is assigned to', async () => {
    await requested('scout');

    await expect(registry.readAssignedCrewRequests(trierarch)).resolves.toEqual([]);
  });
});
