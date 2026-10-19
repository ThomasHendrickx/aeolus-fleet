import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { aCrewSettings, shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import { newKey } from '../../testing/keys.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: ShipCaller;
let plugin: ShipCaller;
let trierarch: ShipCaller;

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
  unwrap(await registry.requestCrew(argo, { shipId, settings: aCrewSettings({ harness: 'claude-code' }) }));
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
      { shipId: scoutId, settings: aCrewSettings({ harness: 'claude-code' }), settingsVersion: 1, requestedAt: core.clock.now(), status: 'running', isFinal: true, ownerShipId: argo.shipId, ownerName: 'argo' },
      { shipId: lookoutId, settings: aCrewSettings({ harness: 'claude-code' }), settingsVersion: 1, requestedAt: core.clock.now(), status: null, isFinal: false, ownerShipId: argo.shipId, ownerName: 'argo' },
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

    unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings({ harness: 'codex' }) }));

    await expect(registry.readAssignedCrewRequests(trierarch)).resolves.toMatchObject([{ shipId: scoutId, settingsVersion: 2, isFinal: false }]);
  });

  it("name each ship's owner as it is now, so its crash report reaches its owner (decision 0045)", async () => {
    const scoutId = await requested('scout');
    unwrap(await registry.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarch.shipId }));
    const { shipId: thomasId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));

    unwrap(await registry.setOwner(argo, { shipId: scoutId, ownerShipId: thomasId }));

    await expect(registry.readAssignedCrewRequests(trierarch)).resolves.toMatchObject([{ shipId: scoutId, ownerShipId: thomasId, ownerName: 'thomas' }]);
  });

  it('are none for a ship nothing is assigned to', async () => {
    await requested('scout');

    await expect(registry.readAssignedCrewRequests(trierarch)).resolves.toEqual([]);
  });
});
