import { SCOPES, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, hostedFleetWithViewer, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import { newKey } from '../../testing/keys.js';
import { wholeShips } from '../../../test/support/ships.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let argoId: ShipId;
let scoutId: ShipId;

const settings = { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'hemma' }, options: {} };

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

    expect(crewRequestOf(scoutId)).toEqual({ fleetId, shipId: scoutId, settings, settingsVersion: 1, requestedAt: core.clock.now(), assignedTo: null, status: null, reason: null, attempt: 0, sessionStartedAt: null, isFinal: false, givenBack: [] });
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

    unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings: { ...settings, harness: 'codex' } }));

    expect(core.state.crewRequests.filter((request) => request.shipId === scoutId)).toEqual([
      { fleetId, shipId: scoutId, settings: { ...settings, harness: 'codex' }, settingsVersion: 2, requestedAt: core.clock.now(), assignedTo: null, status: null, reason: null, attempt: 0, sessionStartedAt: null, isFinal: false, givenBack: [] },
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
    const exact = { ...settings, options: { note: 'x'.repeat(16 * 1024 - JSON.stringify({ ...settings, options: { note: '' } }).length) } };

    await expect(registry.requestCrew(argo, { shipId: scoutId, settings: exact })).resolves.toMatchObject({ isOk: true });
  });

  it('takes machine labels that are label values of the fleet', async () => {
    const plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: ['labels:define'] });
    unwrap(await registry.defineLabel(plugin, { key: 'os', values: ['macos', 'linux'] }));
    const machineLabels = [valueIdOf(core, { key: 'os', value: 'macos' }), valueIdOf(core, { key: 'os', value: 'linux' })];

    await expect(registry.requestCrew(argo, { shipId: scoutId, settings: { ...settings, machineLabels } })).resolves.toMatchObject({ isOk: true });
    expect(crewRequestOf(scoutId)?.settings).toEqual({ ...settings, machineLabels });
  });

  it('takes a first prompt of exactly 8 KB', async () => {
    await expect(registry.requestCrew(argo, { shipId: scoutId, settings: { ...settings, firstPrompt: 'x'.repeat(8 * 1024) } })).resolves.toMatchObject({ isOk: true });
  });
});

describe('a crew request read with the ship', () => {
  it('is none before any request', async () => {
    await expect(registry.getShip(argo, { shipId: scoutId })).resolves.toMatchObject({ value: { crewRequest: null } });
  });

  it('is listed with the fleet by its settings version and when it was requested, never its settings', async () => {
    unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings }));

    const listed = wholeShips(await registry.listFleet(argo)).find((ship) => ship.id === scoutId);

    expect(listed?.crewRequest).toEqual({ settingsVersion: 1, requestedAt: core.clock.now(), assignedTo: null, status: null, reason: null, crewedBy: null, attempt: 0, sessionStartedAt: null, givenBack: [] });
  });

  it('is read whole, settings included, with the one ship', async () => {
    unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings }));

    await expect(registry.getShip(argo, { shipId: scoutId })).resolves.toMatchObject({
      value: { crewRequest: { settings, settingsVersion: 1, requestedAt: core.clock.now() } },
    });
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

  it('refuses a first prompt over 8 KB, with the reason placement would give, before storing anything (#809)', async () => {
    await expectRefused(
      { shipId: scoutId, settings: { ...settings, firstPrompt: 'x'.repeat(8 * 1024 + 1) } },
      { kind: 'CREW_REQUEST_SETTINGS_INVALID', message: 'settings are not valid crew settings: firstPrompt: A first prompt is at most 8192 bytes' },
    );
  });

  it('refuses settings that are not crew settings: an unknown field (#809)', async () => {
    await expectRefused(
      { shipId: scoutId, settings: { ...settings, flags: ['--yolo'] } },
      { kind: 'CREW_REQUEST_SETTINGS_INVALID', message: 'settings are not valid crew settings: Unrecognized key: "flags"' },
    );
  });

  it('refuses settings without a workspace (#809)', async () => {
    await expectRefused({ shipId: scoutId, settings: { harness: 'codex', options: {} } }, { kind: 'CREW_REQUEST_SETTINGS_INVALID' });
  });

  it('refuses a machine label that is no label value of the fleet, naming it, before storing anything (#811)', async () => {
    const unknown = core.ids('labelValue');

    await expectRefused(
      { shipId: scoutId, settings: { ...settings, machineLabels: [unknown] } },
      { kind: 'CREW_REQUEST_SETTINGS_INVALID', message: `settings are not valid crew settings: machineLabels.0: The fleet has no label value ${unknown}` },
    );
  });

  it('refuses a value its label no longer has, among values it has (#811)', async () => {
    const plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: ['labels:define'] });
    const { labelId } = unwrap(await registry.defineLabel(plugin, { key: 'os', values: ['macos', 'linux'] }));
    const macos = valueIdOf(core, { key: 'os', value: 'macos' });
    const linux = valueIdOf(core, { key: 'os', value: 'linux' });
    unwrap(await registry.changeLabelValues(plugin, { labelId, values: ['macos'] }));
    core.state.events.length = 0;

    await expectRefused(
      { shipId: scoutId, settings: { ...settings, machineLabels: [macos, linux] } },
      { kind: 'CREW_REQUEST_SETTINGS_INVALID', message: `settings are not valid crew settings: machineLabels.1: The fleet has no label value ${linux}` },
    );
  });

  it("refuses a label value of another fleet: the caller's fleet scopes the labels (#811)", async () => {
    const other = await hostedFleetWithViewer(core);
    const otherArgo: ShipCaller = { shipId: other.operatorShipId, fleetId: other.fleetId, kind: 'operator', scopes: [...SCOPES] };
    unwrap(await registry.defineLabel(otherArgo, { key: 'os', values: ['macos'] }));
    const foreign = valueIdOf(core, { key: 'os', value: 'macos' });
    core.state.events.length = 0;

    await expectRefused(
      { shipId: scoutId, settings: { ...settings, machineLabels: [foreign] } },
      { kind: 'CREW_REQUEST_SETTINGS_INVALID', message: `settings are not valid crew settings: machineLabels.0: The fleet has no label value ${foreign}` },
    );
  });

  it('refuses argo: the console crews it', async () => {
    await expectRefused({ shipId: argoId, settings }, { kind: 'OPERATOR_SHIP_IS_PERMANENT' });
  });

  it('refuses the viewer ship: no session crews it', async () => {
    const hosted = await hostedFleetWithViewer(core);
    const before = structuredClone(core.state);
    const hostedArgo: ShipCaller = { shipId: hosted.operatorShipId, fleetId: hosted.fleetId, kind: 'operator', scopes: [...SCOPES] };

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
