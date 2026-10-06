import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { newKey } from '../../../test/support/keys.js';

// crew:run reaches only the ships whose crew requests are assigned to the
// caller's ship (decision 0029): it reads that ship, gets its starting prompt
// and releases it, and no other.

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: Caller;
let trierarch: Caller;
let assignedId: ShipId;
let otherId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-06T17:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  const plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] });
  trierarch = await shipWithScopes({ registry, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
  ({ shipId: assignedId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  ({ shipId: otherId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' })));
  unwrap(await registry.requestCrew(argo, { shipId: assignedId, settings: {} }));
  unwrap(await registry.requestCrew(argo, { shipId: otherId, settings: {} }));
  unwrap(await registry.assignCrew(plugin, { shipId: assignedId, trierarchShipId: trierarch.shipId }));
});

describe('a ship with crew:run', () => {
  it('reads an assigned ship', async () => {
    await expect(registry.getShip(trierarch, { shipId: assignedId })).resolves.toMatchObject({ isOk: true, value: { id: assignedId } });
  });

  it('gets the starting prompt of an assigned ship', async () => {
    await expect(registry.getStartingPrompt(trierarch, { shipId: assignedId })).resolves.toMatchObject({ isOk: true });
  });

  it('releases an assigned ship', async () => {
    crewAboard(core, { fleetId, shipId: assignedId });

    await expect(registry.releaseShip(trierarch, { shipId: assignedId })).resolves.toEqual({ isOk: true, value: undefined });
  });

  it('reads no ship that is not assigned to it', async () => {
    await expect(registry.getShip(trierarch, { shipId: otherId })).resolves.toMatchObject({ isOk: false, error: { kind: 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER' } });
  });

  it('gets no starting prompt for a ship that is not assigned to it, and changes nothing', async () => {
    const before = structuredClone(core.state);

    await expect(registry.getStartingPrompt(trierarch, { shipId: otherId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER' },
    });
    expect(core.state).toEqual(before);
  });

  it('releases no ship that is not assigned to it, and changes nothing', async () => {
    crewAboard(core, { fleetId, shipId: otherId });
    const before = structuredClone(core.state);

    await expect(registry.releaseShip(trierarch, { shipId: otherId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER' },
    });
    expect(core.state).toEqual(before);
  });
});

describe('a ship with fleet:manage or fleet:crew', () => {
  it('reaches every ship as before', async () => {
    const crew = await shipWithScopes({ registry, argo }, { name: 'old-trierarch', type: 'trierarch', scopes: ['fleet:crew'] });

    await expect(registry.getStartingPrompt(crew, { shipId: otherId })).resolves.toMatchObject({ isOk: true });
    await expect(registry.getStartingPrompt(argo, { shipId: otherId })).resolves.toMatchObject({ isOk: true });
  });
});
