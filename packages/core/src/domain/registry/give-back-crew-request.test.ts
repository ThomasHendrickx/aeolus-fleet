import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../../test/support/keys.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { createGiveBackCrewRequest } from './give-back-crew-request.js';

// A trierarch gives back a crew request it tried to fulfil and failed, while
// its assignment is not final (#382): the request is unassigned again, its
// lease ends, and the trierarch is recorded so the plugin places it elsewhere.

const REASON = 'mac-mini: claude-code 2.1.293 refused claude-opus-5-5';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases> & { giveBackCrewRequest: ReturnType<typeof createGiveBackCrewRequest> };
let fleetId: FleetId;
let argo: Caller;
let plugin: Caller;
let trierarch: Caller;
let scoutId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-09T08:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = { ...registryUseCases(core), giveBackCrewRequest: createGiveBackCrewRequest({ uow: core.uow, clock: core.clock, ids: core.ids }) };
  plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] });
  trierarch = await shipWithScopes({ registry, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
  ({ shipId: scoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings: { harness: 'claude-code', options: { model: 'claude-opus-5-5' } } }));
  unwrap(await registry.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarch.shipId }));
  unwrap(await registry.reportCrewStatus(trierarch, { shipId: scoutId, status: 'crewing' }));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

const crewRequestOf = (shipId: ShipId) => core.state.crewRequests.find((request) => request.fleetId === fleetId && request.shipId === shipId);
const giveBack = (caller: Caller, at: { settingsVersion?: number; reason?: string } = {}) =>
  registry.giveBackCrewRequest(caller, { shipId: scoutId, settingsVersion: at.settingsVersion ?? 1, reason: at.reason ?? REASON });

describe('a trierarch giving back a crew request', () => {
  it('unassigns it, clears its status, and records the trierarch with the reason, with CrewRequestGivenBack', async () => {
    await expect(giveBack(trierarch)).resolves.toEqual({ isOk: true, value: undefined });

    expect(crewRequestOf(scoutId)).toMatchObject({
      assignedTo: null,
      status: null,
      attempt: 0,
      sessionStartedAt: null,
      givenBack: [{ trierarchShipId: trierarch.shipId, settingsVersion: 1, reason: REASON, givenBackAt: core.clock.now() }],
    });
    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'CrewRequestGivenBack',
        actor: { kind: 'ship', shipId: trierarch.shipId },
        shipId: scoutId,
        details: { trierarchShipId: trierarch.shipId, settingsVersion: 1, reason: REASON },
      }),
    ]);
  });

  it('gives back a request it has not written a status for yet', async () => {
    const lookout = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' }));
    unwrap(await registry.requestCrew(argo, { shipId: lookout.shipId, settings: {} }));
    unwrap(await registry.assignCrew(plugin, { shipId: lookout.shipId, trierarchShipId: trierarch.shipId }));

    await expect(registry.giveBackCrewRequest(trierarch, { shipId: lookout.shipId, settingsVersion: 1, reason: REASON })).resolves.toEqual({ isOk: true, value: undefined });
  });

  it('ends the lease its registration holds, so the ship awaits crew and can be placed again', async () => {
    const crew = crewAboard(core, { fleetId, shipId: scoutId });

    unwrap(await giveBack(trierarch));

    expect(core.state.leases.find((lease) => lease.id === crew.leaseId)?.endedAt).toEqual(core.clock.now());
    await expect(registry.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarch.shipId })).resolves.toMatchObject({ isOk: true });
  });

  it('shows on the request in the fleet list, by trierarch, with the settings version, the reason and when', async () => {
    unwrap(await giveBack(trierarch));

    const listed = (await registry.listFleet(argo)).find((ship) => ship.id === scoutId);

    expect(listed?.crewRequest?.givenBack).toEqual([{ trierarch: { id: trierarch.shipId, name: 'mac-mini' }, settingsVersion: 1, reason: REASON, givenBackAt: core.clock.now() }]);
  });

  it('keeps every trierarch that gave it back', async () => {
    unwrap(await giveBack(trierarch));
    const linux = await shipWithScopes({ registry, argo }, { name: 'linux-box', type: 'trierarch', scopes: ['crew:run'] });
    unwrap(await registry.assignCrew(plugin, { shipId: scoutId, trierarchShipId: linux.shipId }));

    unwrap(await giveBack(linux, { reason: 'linux-box: nothing on screen within a minute' }));

    expect(crewRequestOf(scoutId)?.givenBack.map((back) => back.trierarchShipId)).toEqual([trierarch.shipId, linux.shipId]);
  });

  it('is an OK with no event when the same trierarch gives the same settings version back again, as a retry after a lost answer', async () => {
    unwrap(await giveBack(trierarch));
    core.state.events.length = 0;

    await expect(giveBack(trierarch)).resolves.toEqual({ isOk: true, value: undefined });
    expect(core.state.events).toEqual([]);
  });

  it('clears what was given back on a new settings version, so every trierarch may take it again', async () => {
    unwrap(await giveBack(trierarch));

    unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings: { harness: 'claude-code' } }));

    expect(crewRequestOf(scoutId)?.givenBack).toEqual([]);
  });
});

describe('a give-back refused', () => {
  it.each(['running', 'restarting', 'crashed'] as const)('refuses a request whose crew is final, its status %s, and changes nothing', async (status) => {
    unwrap(await registry.reportCrewStatus(trierarch, { shipId: scoutId, status }));
    const before = structuredClone(core.state);

    await expect(giveBack(trierarch)).resolves.toMatchObject({ isOk: false, error: { kind: 'CREW_REQUEST_FINAL' } });
    expect(core.state).toEqual(before);
  });

  it('refuses a releasing request', async () => {
    unwrap(await registry.removeCrewRequest(argo, { shipId: scoutId }));

    await expect(giveBack(trierarch)).resolves.toMatchObject({ isOk: false, error: { kind: 'CREW_REQUEST_RELEASING' } });
  });

  it('refuses a trierarch the request is not assigned to', async () => {
    const other = await shipWithScopes({ registry, argo }, { name: 'linux-box', type: 'trierarch', scopes: ['crew:run'] });

    await expect(giveBack(other)).resolves.toMatchObject({ isOk: false, error: { kind: 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER' } });
  });

  it('refuses a settings version that is no longer the request: an edit moved it on', async () => {
    unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings: { harness: 'codex' } }));

    await expect(giveBack(trierarch, { settingsVersion: 1 })).resolves.toMatchObject({ isOk: false, error: { kind: 'CREW_REQUEST_SETTINGS_CHANGED' } });
  });

  it('refuses a reason of more than one line or over 200 characters', async () => {
    await expect(giveBack(trierarch, { reason: 'first\nsecond' })).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_CREW_REQUEST_REASON' } });
    await expect(giveBack(trierarch, { reason: 'x'.repeat(201) })).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_CREW_REQUEST_REASON' } });
  });

  it('refuses a ship without a crew request', async () => {
    const lookout = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' }));

    await expect(registry.giveBackCrewRequest(trierarch, { shipId: lookout.shipId, settingsVersion: 1, reason: REASON })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'CREW_REQUEST_NOT_FOUND' },
    });
  });
});
