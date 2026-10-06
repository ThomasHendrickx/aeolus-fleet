import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { newKey } from '../../../test/support/keys.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: Caller;
let trierarch: Caller;
let scoutId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-06T17:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  const plugin = await shipWithScopes(registry, argo, { name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] });
  trierarch = await shipWithScopes(registry, argo, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
  ({ shipId: scoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings: { harness: 'claude-code' } }));
  unwrap(await registry.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarch.shipId }));
  unwrap(await registry.reportCrewStatus(trierarch, { shipId: scoutId, status: 'running' }));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

function crewRequestOf(shipId: ShipId) {
  return core.state.crewRequests.find((request) => request.fleetId === fleetId && request.shipId === shipId);
}

describe('removing an assigned crew request', () => {
  it('marks it releasing and keeps it, with CrewStatusChanged caused by the requester', async () => {
    await expect(registry.removeCrewRequest(argo, { shipId: scoutId })).resolves.toEqual({ isOk: true, value: undefined });

    expect(crewRequestOf(scoutId)).toMatchObject({ assignedTo: trierarch.shipId, status: 'releasing' });
    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'CrewStatusChanged', actor: { kind: 'ship', shipId: argo.shipId }, shipId: scoutId, details: { status: 'releasing' } }),
    ]);
  });

  it('is an OK with no event when it is releasing already', async () => {
    unwrap(await registry.removeCrewRequest(argo, { shipId: scoutId }));
    core.state.events.length = 0;

    await expect(registry.removeCrewRequest(argo, { shipId: scoutId })).resolves.toEqual({ isOk: true, value: undefined });
    expect(core.state.events).toEqual([]);
  });

  it('refuses new settings while it is releasing: request again after the trierarch confirms', async () => {
    unwrap(await registry.removeCrewRequest(argo, { shipId: scoutId }));

    await expect(registry.requestCrew(argo, { shipId: scoutId, settings: {} })).resolves.toMatchObject({ isOk: false, error: { kind: 'CREW_REQUEST_RELEASING' } });
  });
});

describe('the trierarch confirming a release', () => {
  beforeEach(async () => {
    unwrap(await registry.removeCrewRequest(argo, { shipId: scoutId }));
    core.state.events.length = 0;
  });

  it('removes the request, with CrewRequestRemoved caused by the trierarch', async () => {
    await expect(registry.confirmCrewRelease(trierarch, { shipId: scoutId })).resolves.toEqual({ isOk: true, value: undefined });

    expect(crewRequestOf(scoutId)).toBeUndefined();
    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'CrewRequestRemoved', actor: { kind: 'ship', shipId: trierarch.shipId }, shipId: scoutId }),
    ]);
  });

  it('refuses a trierarch the request is not assigned to', async () => {
    const other = await shipWithScopes(registry, argo, { name: 'linux-box', type: 'trierarch', scopes: ['crew:run'] });

    await expect(registry.confirmCrewRelease(other, { shipId: scoutId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER' },
    });
  });
});

describe('a confirm refused before the release', () => {
  it('refuses a request that is not releasing', async () => {
    const before = structuredClone(core.state);

    await expect(registry.confirmCrewRelease(trierarch, { shipId: scoutId })).resolves.toMatchObject({ isOk: false, error: { kind: 'CREW_REQUEST_NOT_RELEASING' } });
    expect(core.state).toEqual(before);
  });
});
