import { createIdGenerator } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createChangeLabelValues } from '../src/domain/registry/change-label-values.js';
import type { Caller } from '../src/domain/shared/caller.js';
import { OPERATOR, operatorCaller } from './support/core-fixtures.js';
import { createPostgresCore, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';
import { aCrewSettings } from './support/crew-fixtures.js';
import { wholeShips } from './support/ships.js';

// Crew requests on a real Postgres: one per ship, replaced in place, removed
// by its requester or with a retire, each change with its event.

const newId = createIdGenerator();

let core: PostgresCore;
let argo: Caller;
let scoutId: Caller['shipId'];

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  ({ shipId: scoutId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  core.clock.advance(60_000);
});

afterEach(async () => {
  await core.close();
});

async function crewRequests() {
  return core.prisma.crewRequest.findMany({ where: { shipId: scoutId } });
}

describe('a crew request on Postgres', () => {
  it('is stored once per ship, its settings as JSON, replaced in place with the next settings version', async () => {
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings({ harness: 'claude-code' }) }));
    core.clock.advance(60_000);

    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings({ harness: 'codex', options: { sandbox: true } }) }));

    await expect(crewRequests()).resolves.toEqual([
      expect.objectContaining({
        shipId: scoutId,
        settings: aCrewSettings({ harness: 'codex', options: { sandbox: true } }),
        settingsVersion: 2,
        requestedAt: core.clock.now(),
      }),
    ]);
    await expect(core.prisma.event.count({ where: { type: 'CrewRequested', shipId: scoutId } })).resolves.toBe(2);
  });

  it('is read with the ship: its settings version in the fleet list, its settings with the one ship', async () => {
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings({ harness: 'codex' }) }));

    const listed = wholeShips(await core.useCases.listFleet(argo)).find((ship) => ship.id === scoutId);
    expect(listed?.crewRequest).toEqual({ settingsVersion: 1, requestedAt: core.clock.now(), assignedTo: null, status: null, reason: null, crewedBy: null, attempt: 0, sessionStartedAt: null, givenBack: [] });
    await expect(core.useCases.getShip(argo, { shipId: scoutId })).resolves.toMatchObject({
      value: { crewRequest: { settings: aCrewSettings({ harness: 'codex' }), settingsVersion: 1, requestedAt: core.clock.now() } },
    });
  });

  it('is refused with settings that are not crew settings, storing no request and no event, and keeps the request the ship holds (#809)', async () => {
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings({ harness: 'codex' }) }));

    await expect(core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings({ firstPrompt: 'x'.repeat(8 * 1024 + 1) }) })).resolves.toEqual({
      isOk: false,
      error: { kind: 'CREW_REQUEST_SETTINGS_INVALID', message: 'settings are not valid crew settings: firstPrompt: A first prompt is at most 8192 bytes' },
    });
    await expect(crewRequests()).resolves.toEqual([expect.objectContaining({ settings: aCrewSettings({ harness: 'codex' }), settingsVersion: 1 })]);
    await expect(core.prisma.event.count({ where: { type: 'CrewRequested', shipId: scoutId } })).resolves.toBe(1);
  });

  it('takes machine labels that are label values of the fleet (#811)', async () => {
    const os = unwrap(await core.useCases.defineLabel(argo, { key: 'os', values: ['macos', 'linux'] }));
    const machineLabels = os.values.map((value) => value.id);

    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings({ machineLabels }) }));

    await expect(crewRequests()).resolves.toEqual([expect.objectContaining({ settings: aCrewSettings({ machineLabels }) })]);
  });

  it('is refused with a machine label that is no label value of the fleet, storing no request and no event (#811)', async () => {
    const unknown = newId('labelValue');

    await expect(core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings({ machineLabels: [unknown] }) })).resolves.toEqual({
      isOk: false,
      error: { kind: 'CREW_REQUEST_SETTINGS_INVALID', message: `settings are not valid crew settings: machineLabels.0: The fleet has no label value ${unknown}` },
    });
    await expect(crewRequests()).resolves.toEqual([]);
    await expect(core.prisma.event.count({ where: { type: 'CrewRequested', shipId: scoutId } })).resolves.toBe(0);
  });

  it('waits for a change of values that locked the label first, then is refused: the value is gone (#811)', async () => {
    const os = unwrap(await core.useCases.defineLabel(argo, { key: 'os', values: ['macos', 'linux'] }));
    const linux = os.values[1]?.id ?? newId('labelValue');
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      labels: {
        ...tx.labels,
        carriersOf: async (fleetId, labelId) => {
          await hold();
          return tx.labels.carriersOf(fleetId, labelId);
        },
      },
    }));
    const change = createChangeLabelValues({ uow, clock: core.clock, ids: newId })(argo, { labelId: os.labelId, values: ['macos'] });
    await reached;

    const request = core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings({ machineLabels: [linux] }) });

    await expect(change).resolves.toMatchObject({ isOk: true });
    await expect(request).resolves.toMatchObject({ isOk: false, error: { kind: 'CREW_REQUEST_SETTINGS_INVALID' } });
    await expect(crewRequests()).resolves.toEqual([]);
  });

  it('is removed by its requester, with CrewRequestRemoved', async () => {
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings() }));

    unwrap(await core.useCases.removeCrewRequest(argo, { shipId: scoutId }));

    await expect(crewRequests()).resolves.toEqual([]);
    await expect(core.prisma.event.count({ where: { type: 'CrewRequestRemoved', shipId: scoutId } })).resolves.toBe(1);
  });

  it('goes with a retire', async () => {
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings() }));

    unwrap(await core.useCases.retireShip(argo, { shipId: scoutId }));

    await expect(crewRequests()).resolves.toEqual([]);
  });

  it('is assigned to a trierarch, takes its status, is released through it and is read by it as assigned', async () => {
    const { shipId: pluginId } = unwrap(
      await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] }),
    );
    const { shipId: trierarchId } = unwrap(
      await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] }),
    );
    const plugin: Caller = { fleetId: argo.fleetId, shipId: pluginId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:assign'] };
    const trierarch: Caller = { fleetId: argo.fleetId, shipId: trierarchId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:run'] };
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings({ harness: 'codex' }) }));

    unwrap(await core.useCases.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarchId }));
    await expect(core.useCases.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarchId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'CREW_REQUEST_ALREADY_ASSIGNED' },
    });
    unwrap(await core.useCases.reportCrewStatus(trierarch, { shipId: scoutId, status: 'running', attempt: 1, startedAt: '2026-10-06T17:00:30.000Z' }));

    await expect(core.useCases.listFleet(argo).then(wholeShips).then((ships) => ships.find((ship) => ship.id === scoutId)?.crewRequest)).resolves.toMatchObject({
      attempt: 1,
      sessionStartedAt: new Date('2026-10-06T17:00:30.000Z'),
    });
    await expect(core.useCases.readAssignedCrewRequests(trierarch)).resolves.toEqual([
      { shipId: scoutId, settings: aCrewSettings({ harness: 'codex' }), settingsVersion: 1, requestedAt: core.clock.now(), status: 'running', isFinal: true, ownerShipId: argo.shipId, ownerName: 'argo' },
    ]);
    await expect(core.useCases.getShip(trierarch, { shipId: scoutId })).resolves.toMatchObject({
      value: { crewRequest: { assignedTo: { id: trierarchId, name: 'mac-mini' }, status: 'running' } },
    });

    unwrap(await core.useCases.removeCrewRequest(argo, { shipId: scoutId }));
    await expect(crewRequests()).resolves.toEqual([expect.objectContaining({ assignedTo: trierarchId, status: 'releasing' })]);
    unwrap(await core.useCases.confirmCrewRelease(trierarch, { shipId: scoutId }));

    await expect(crewRequests()).resolves.toEqual([]);
    await expect(
      core.prisma.event.findMany({ where: { shipId: scoutId, type: { in: ['CrewAssigned', 'CrewStatusChanged', 'CrewRequestRemoved'] } }, orderBy: { seq: 'asc' }, select: { type: true } }),
    ).resolves.toEqual([{ type: 'CrewAssigned' }, { type: 'CrewStatusChanged' }, { type: 'CrewStatusChanged' }, { type: 'CrewRequestRemoved' }]);
  });

  it('keeps the reason the assigner writes until assignment, and shows who crewed the ship from the prompt it claimed with', async () => {
    const { shipId: pluginId } = unwrap(
      await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'navarch', type: 'navarch', scopes: ['crew:assign'] }),
    );
    const plugin: Caller = { fleetId: argo.fleetId, shipId: pluginId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:assign'] };
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings({ harness: 'codex' }) }));

    unwrap(await core.useCases.explainCrewRequest(plugin, { shipId: scoutId, reason: 'no trierarch offers codex' }));
    const { secret } = unwrap(await core.useCases.getStartingPrompt(argo, { shipId: scoutId }));
    core.clock.advance(1_000);
    unwrap(await core.useCases.claimShip({ shipId: scoutId, secret, location: { kind: 'DEVICE' }, harness: 'claude-code' }));

    const listed = wholeShips(await core.useCases.listFleet(argo)).find((ship) => ship.id === scoutId);
    expect(listed?.crewRequest).toMatchObject({ reason: 'no trierarch offers codex', crewedBy: { id: argo.shipId, name: 'argo' } });
    await expect(core.prisma.event.count({ where: { shipId: scoutId, type: 'CrewRequestExplained' } })).resolves.toBe(1);
  });

  it('is given back by its trierarch before its crew is final: unassigned, its lease ended, the trierarch kept until the next settings version (#382)', async () => {
    const { shipId: pluginId } = unwrap(
      await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] }),
    );
    const { shipId: trierarchId } = unwrap(
      await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] }),
    );
    const plugin: Caller = { fleetId: argo.fleetId, shipId: pluginId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:assign'] };
    const trierarch: Caller = { fleetId: argo.fleetId, shipId: trierarchId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:run'] };
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings({ harness: 'claude-code', options: { model: 'claude-opus-5-5' } }) }));
    unwrap(await core.useCases.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarchId }));
    unwrap(await core.useCases.reportCrewStatus(trierarch, { shipId: scoutId, status: 'crewing' }));
    const { secret } = unwrap(await core.useCases.getStartingPrompt(trierarch, { shipId: scoutId }));
    unwrap(await core.useCases.claimShip({ shipId: scoutId, secret, location: { kind: 'DEVICE' }, harness: 'claude-code' }));
    core.clock.advance(60_000);
    const reason = 'mac-mini: claude-code 2.1.293 refused claude-opus-5-5';

    unwrap(await core.useCases.giveBackCrewRequest(trierarch, { shipId: scoutId, settingsVersion: 1, reason }));

    const listed = wholeShips(await core.useCases.listFleet(argo)).find((ship) => ship.id === scoutId);
    expect(listed).toMatchObject({ status: 'awaitingCrew' });
    expect(listed?.crewRequest).toMatchObject({
      assignedTo: null,
      status: null,
      givenBack: [{ trierarch: { id: trierarchId, name: 'mac-mini' }, settingsVersion: 1, reason, givenBackAt: core.clock.now() }],
    });
    await expect(core.prisma.event.count({ where: { shipId: scoutId, type: 'CrewRequestGivenBack' } })).resolves.toBe(1);
    await expect(core.useCases.giveBackCrewRequest(trierarch, { shipId: scoutId, settingsVersion: 1, reason })).resolves.toEqual({ isOk: true, value: undefined });

    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings({ harness: 'claude-code' }) }));
    await expect(core.useCases.listFleet(argo).then(wholeShips).then((ships) => ships.find((ship) => ship.id === scoutId)?.crewRequest?.givenBack)).resolves.toEqual([]);
  });
  it('keeps its crew final once its trierarch saw it working, so a give-back is refused after a crewing status (#472)', async () => {
    const { shipId: pluginId } = unwrap(
      await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] }),
    );
    const { shipId: trierarchId } = unwrap(
      await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] }),
    );
    const plugin: Caller = { fleetId: argo.fleetId, shipId: pluginId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:assign'] };
    const trierarch: Caller = { fleetId: argo.fleetId, shipId: trierarchId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:run'] };
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings({ harness: 'claude-code' }) }));
    unwrap(await core.useCases.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarchId }));
    unwrap(await core.useCases.reportCrewStatus(trierarch, { shipId: scoutId, status: 'running' }));

    unwrap(await core.useCases.reportCrewStatus(trierarch, { shipId: scoutId, status: 'crewing' }));

    await expect(core.useCases.giveBackCrewRequest(trierarch, { shipId: scoutId, settingsVersion: 1, reason: 'mac-mini: nothing on screen within a minute' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'CREW_REQUEST_FINAL' },
    });
    await expect(crewRequests()).resolves.toEqual([expect.objectContaining({ assignedTo: trierarchId, status: 'crewing' })]);
  });

  it('is read by its trierarch as final once it saw its crew working, and not final again after a new settings version (#477)', async () => {
    const { shipId: pluginId } = unwrap(
      await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] }),
    );
    const { shipId: trierarchId } = unwrap(
      await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] }),
    );
    const plugin: Caller = { fleetId: argo.fleetId, shipId: pluginId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:assign'] };
    const trierarch: Caller = { fleetId: argo.fleetId, shipId: trierarchId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:run'] };
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings({ harness: 'claude-code' }) }));
    unwrap(await core.useCases.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarchId }));
    unwrap(await core.useCases.reportCrewStatus(trierarch, { shipId: scoutId, status: 'running' }));
    unwrap(await core.useCases.reportCrewStatus(trierarch, { shipId: scoutId, status: 'crewing' }));

    await expect(core.useCases.readAssignedCrewRequests(trierarch)).resolves.toMatchObject([{ shipId: scoutId, status: 'crewing', isFinal: true }]);
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: aCrewSettings({ harness: 'codex' }) }));
    await expect(core.useCases.readAssignedCrewRequests(trierarch)).resolves.toMatchObject([{ shipId: scoutId, settingsVersion: 2, isFinal: false }]);
  });
});
