import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { newKey } from '../../../test/support/keys.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: Caller;
let argoId: ShipId;
let scoutId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-06T15:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  ({ shipId: scoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings: { harness: 'claude-code' } }));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

describe('removing a crew request', () => {
  it('removes an unassigned request at once', async () => {
    await expect(registry.removeCrewRequest(argo, { shipId: scoutId })).resolves.toEqual({ isOk: true, value: undefined });

    expect(core.state.crewRequests.filter((request) => request.fleetId === fleetId)).toEqual([]);
  });

  it('writes CrewRequestRemoved, caused by the requester', async () => {
    unwrap(await registry.removeCrewRequest(argo, { shipId: scoutId }));

    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'CrewRequestRemoved', occurredAt: core.clock.now(), actor: { kind: 'ship', shipId: argoId }, shipId: scoutId }),
    ]);
  });

  it('starts the settings version again at 1 for a new request', async () => {
    unwrap(await registry.removeCrewRequest(argo, { shipId: scoutId }));

    await expect(registry.requestCrew(argo, { shipId: scoutId, settings: {} })).resolves.toEqual({ isOk: true, value: { settingsVersion: 1 } });
  });

  it('refuses a ship without a crew request, and changes nothing', async () => {
    unwrap(await registry.removeCrewRequest(argo, { shipId: scoutId }));
    core.state.events.length = 0;

    await expect(registry.removeCrewRequest(argo, { shipId: scoutId })).resolves.toMatchObject({ isOk: false, error: { kind: 'CREW_REQUEST_NOT_FOUND' } });
    expect(core.state.events).toEqual([]);
  });

  it('refuses a ship that is not in the fleet', async () => {
    await expect(registry.removeCrewRequest(argo, { shipId: core.ids('ship') })).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_NOT_FOUND' } });
  });
});

describe('retiring a ship with a crew request', () => {
  it('removes its request, with CrewRequestRemoved', async () => {
    unwrap(await registry.retireShip(argo, { shipId: scoutId }));

    expect(core.state.crewRequests.filter((request) => request.fleetId === fleetId)).toEqual([]);
    expect(core.state.events.map((event) => event.type)).toContain('CrewRequestRemoved');
  });
});
