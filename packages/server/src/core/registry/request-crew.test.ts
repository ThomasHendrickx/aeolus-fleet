import { SCOPES, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, hostedFleetWithViewer, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
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

const settings = { harness: 'claude-code', workspace: { repository: 'hemma' } };

beforeEach(async () => {
  core = createInMemoryCore('2026-10-06T15:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  ({ shipId: scoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

function crewRequestOf(shipId: ShipId) {
  return core.state.crewRequests.find((request) => request.fleetId === fleetId && request.shipId === shipId);
}

describe('requesting a crew for a ship', () => {
  it('keeps the request on the ship with its settings, at settings version 1', async () => {
    await expect(registry.requestCrew(argo, { shipId: scoutId, settings })).resolves.toEqual({ isOk: true, value: { settingsVersion: 1 } });

    expect(crewRequestOf(scoutId)).toEqual({ fleetId, shipId: scoutId, settings, settingsVersion: 1, requestedAt: core.clock.now() });
  });

  it('writes CrewRequested, caused by the requester, with the settings version, never the settings', async () => {
    unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'CrewRequested',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: argoId },
        shipId: scoutId,
        details: { settingsVersion: 1 },
      }),
    ]);
  });

  it('replaces the settings of a ship that has a request: one request per ship, its settings version one more', async () => {
    unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings }));
    core.clock.advance(60_000);

    unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings: { harness: 'codex' } }));

    expect(core.state.crewRequests.filter((request) => request.shipId === scoutId)).toEqual([
      { fleetId, shipId: scoutId, settings: { harness: 'codex' }, settingsVersion: 2, requestedAt: core.clock.now() },
    ]);
  });

  it('counts the settings version up on every request, the same settings too', async () => {
    unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings }));

    await expect(registry.requestCrew(argo, { shipId: scoutId, settings })).resolves.toEqual({ isOk: true, value: { settingsVersion: 2 } });
    expect(core.state.events.map((event) => event.details)).toEqual([{ settingsVersion: 1 }, { settingsVersion: 2 }]);
  });

  it('takes a crewed ship: the request stands for keeping it crewed', async () => {
    crewAboard(core, { fleetId, shipId: scoutId });

    await expect(registry.requestCrew(argo, { shipId: scoutId, settings })).resolves.toMatchObject({ isOk: true });
  });

  it('takes settings of exactly 16 KB', async () => {
    const exact = { x: 'x'.repeat(16 * 1024 - '{"x":""}'.length) };

    await expect(registry.requestCrew(argo, { shipId: scoutId, settings: exact })).resolves.toMatchObject({ isOk: true });
  });
});

describe('a crew request refused', () => {
  async function expectRefused(input: Parameters<typeof registry.requestCrew>[1], error: { kind: string; message?: string }): Promise<void> {
    const before = structuredClone(core.state);

    await expect(registry.requestCrew(argo, input)).resolves.toMatchObject({ isOk: false, error });

    expect(core.state).toEqual(before);
  }

  it('refuses settings over 16 KB, naming their size, the limit and the decision', async () => {
    await expectRefused(
      { shipId: scoutId, settings: { x: 'x'.repeat(16 * 1024 - '{"x":""}'.length + 1) } },
      { kind: 'CREW_REQUEST_SETTINGS_TOO_LARGE', message: 'settings is 16385 bytes, the limit is 16384 (decision 0029)' },
    );
  });

  it('refuses argo: the console crews it', async () => {
    await expectRefused({ shipId: argoId, settings }, { kind: 'OPERATOR_SHIP_IS_PERMANENT' });
  });

  it('refuses the viewer ship: no session crews it', async () => {
    const hosted = await hostedFleetWithViewer(core);
    const before = structuredClone(core.state);
    const hostedArgo: Caller = { shipId: hosted.operatorShipId, fleetId: hosted.fleetId, kind: 'operator', scopes: [...SCOPES] };

    await expect(registry.requestCrew(hostedArgo, { shipId: hosted.viewerShipId, settings })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'OPERATOR_SHIP_IS_PERMANENT' },
    });
    expect(core.state).toEqual(before);
  });

  it('refuses a retired ship', async () => {
    unwrap(await registry.retireShip(argo, { shipId: scoutId }));
    core.state.events.length = 0;

    await expectRefused({ shipId: scoutId, settings }, { kind: 'SHIP_ALREADY_RETIRED' });
  });

  it('refuses a ship that is not in the fleet', async () => {
    await expectRefused({ shipId: core.ids('ship'), settings }, { kind: 'SHIP_NOT_FOUND' });
  });
});
