import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { newKey } from '../../../test/support/keys.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: Caller;
let plugin: Caller;
let trierarch: Caller;
let scoutId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-06T17:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  plugin = await shipWithScopes(registry, argo, { name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] });
  trierarch = await shipWithScopes(registry, argo, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
  ({ shipId: scoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings: { harness: 'claude-code' } }));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

function crewRequestOf(shipId: ShipId) {
  return core.state.crewRequests.find((request) => request.fleetId === fleetId && request.shipId === shipId);
}

describe('assigning a crew request', () => {
  it('assigns the request to the trierarch, with no status yet', async () => {
    await expect(registry.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarch.shipId })).resolves.toEqual({ isOk: true, value: undefined });

    expect(crewRequestOf(scoutId)).toMatchObject({ assignedTo: trierarch.shipId, status: null });
  });

  it('writes CrewAssigned, caused by the assigner, naming the trierarch', async () => {
    unwrap(await registry.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarch.shipId }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'CrewAssigned',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: plugin.shipId },
        shipId: scoutId,
        details: { assignedTo: trierarch.shipId },
      }),
    ]);
  });

  it('keeps the assignment and the status when the settings are replaced', async () => {
    unwrap(await registry.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarch.shipId }));
    unwrap(await registry.reportCrewStatus(trierarch, { shipId: scoutId, status: 'running' }));

    unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings: { harness: 'codex' } }));

    expect(crewRequestOf(scoutId)).toMatchObject({ settingsVersion: 2, assignedTo: trierarch.shipId, status: 'running' });
  });
});

describe('an assignment refused', () => {
  async function expectRefused(input: Parameters<typeof registry.assignCrew>[1], kind: string): Promise<void> {
    const before = structuredClone(core.state);

    await expect(registry.assignCrew(plugin, input)).resolves.toMatchObject({ isOk: false, error: { kind } });

    expect(core.state).toEqual(before);
  }

  it('refuses a request assigned already: the claim is optimistic, the first wins', async () => {
    const other = await shipWithScopes(registry, argo, { name: 'linux-box', type: 'trierarch', scopes: ['crew:run'] });
    unwrap(await registry.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarch.shipId }));
    core.state.events.length = 0;

    await expectRefused({ shipId: scoutId, trierarchShipId: other.shipId }, 'CREW_REQUEST_ALREADY_ASSIGNED');
  });

  it('refuses a ship that is crewed: crewing it by hand fulfils the request', async () => {
    crewAboard(core, { fleetId, shipId: scoutId });

    await expectRefused({ shipId: scoutId, trierarchShipId: trierarch.shipId }, 'SHIP_NOT_AWAITING_CREW');
  });

  it('refuses a ship without a crew request', async () => {
    unwrap(await registry.removeCrewRequest(argo, { shipId: scoutId }));
    core.state.events.length = 0;

    await expectRefused({ shipId: scoutId, trierarchShipId: trierarch.shipId }, 'CREW_REQUEST_NOT_FOUND');
  });

  it('refuses an assignee that does not hold crew:run', async () => {
    await expectRefused({ shipId: scoutId, trierarchShipId: plugin.shipId }, 'ASSIGNEE_CANNOT_RUN_CREWS');
  });

  it('refuses an assignee that is retired', async () => {
    unwrap(await registry.retireShip(argo, { shipId: trierarch.shipId }));
    core.state.events.length = 0;

    await expectRefused({ shipId: scoutId, trierarchShipId: trierarch.shipId }, 'ASSIGNEE_CANNOT_RUN_CREWS');
  });

  it('refuses an assignee that is not in the fleet', async () => {
    await expectRefused({ shipId: scoutId, trierarchShipId: core.ids('ship') }, 'ASSIGNEE_CANNOT_RUN_CREWS');
  });

  it('refuses a ship that is not in the fleet', async () => {
    await expectRefused({ shipId: core.ids('ship'), trierarchShipId: trierarch.shipId }, 'SHIP_NOT_FOUND');
  });
});
