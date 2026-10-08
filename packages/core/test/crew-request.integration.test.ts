import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Caller } from '../src/domain/shared/caller.js';
import { OPERATOR, operatorCaller } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// Crew requests on a real Postgres: one per ship, replaced in place, removed
// by its requester or with a retire, each change with its event.

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
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: { harness: 'claude-code' } }));
    core.clock.advance(60_000);

    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: { harness: 'codex', options: { sandbox: true } } }));

    await expect(crewRequests()).resolves.toEqual([
      expect.objectContaining({
        shipId: scoutId,
        settings: { harness: 'codex', options: { sandbox: true } },
        settingsVersion: 2,
        requestedAt: core.clock.now(),
      }),
    ]);
    await expect(core.prisma.event.count({ where: { type: 'CrewRequested', shipId: scoutId } })).resolves.toBe(2);
  });

  it('is read with the ship: its settings version in the fleet list, its settings with the one ship', async () => {
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: { harness: 'codex' } }));

    const listed = (await core.useCases.listFleet(argo)).find((ship) => ship.id === scoutId);
    expect(listed?.crewRequest).toEqual({ settingsVersion: 1, requestedAt: core.clock.now(), assignedTo: null, status: null, reason: null, crewedBy: null, attempt: 0, sessionStartedAt: null, givenBack: [] });
    await expect(core.useCases.getShip(argo, { shipId: scoutId })).resolves.toMatchObject({
      value: { crewRequest: { settings: { harness: 'codex' }, settingsVersion: 1, requestedAt: core.clock.now() } },
    });
  });

  it('is removed by its requester, with CrewRequestRemoved', async () => {
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: {} }));

    unwrap(await core.useCases.removeCrewRequest(argo, { shipId: scoutId }));

    await expect(crewRequests()).resolves.toEqual([]);
    await expect(core.prisma.event.count({ where: { type: 'CrewRequestRemoved', shipId: scoutId } })).resolves.toBe(1);
  });

  it('goes with a retire', async () => {
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: {} }));

    unwrap(await core.useCases.retireShip(argo, { shipId: scoutId }));

    await expect(crewRequests()).resolves.toEqual([]);
  });

  it('is assigned to a trierarch, takes its status, is released through it and is read by it as assigned', async () => {
    const { shipId: pluginId } = unwrap(
      await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'trierarch-plugin', type: 'plugin', fleetScopes: ['crew:assign'] }),
    );
    const { shipId: trierarchId } = unwrap(
      await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'mac-mini', type: 'trierarch', fleetScopes: ['crew:run'] }),
    );
    const plugin: Caller = { fleetId: argo.fleetId, shipId: pluginId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:assign'] };
    const trierarch: Caller = { fleetId: argo.fleetId, shipId: trierarchId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:run'] };
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: { harness: 'codex' } }));

    unwrap(await core.useCases.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarchId }));
    await expect(core.useCases.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarchId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'CREW_REQUEST_ALREADY_ASSIGNED' },
    });
    unwrap(await core.useCases.reportCrewStatus(trierarch, { shipId: scoutId, status: 'running', attempt: 1, startedAt: '2026-10-06T17:00:30.000Z' }));

    await expect(core.useCases.listFleet(argo).then((ships) => ships.find((ship) => ship.id === scoutId)?.crewRequest)).resolves.toMatchObject({
      attempt: 1,
      sessionStartedAt: new Date('2026-10-06T17:00:30.000Z'),
    });
    await expect(core.useCases.readAssignedCrewRequests(trierarch)).resolves.toEqual([
      { shipId: scoutId, settings: { harness: 'codex' }, settingsVersion: 1, requestedAt: core.clock.now(), status: 'running' },
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
      await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'navarch', type: 'navarch', fleetScopes: ['crew:assign'] }),
    );
    const plugin: Caller = { fleetId: argo.fleetId, shipId: pluginId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:assign'] };
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: { harness: 'codex' } }));

    unwrap(await core.useCases.explainCrewRequest(plugin, { shipId: scoutId, reason: 'no trierarch offers codex' }));
    const { secret } = unwrap(await core.useCases.getStartingPrompt(argo, { shipId: scoutId }));
    core.clock.advance(1_000);
    unwrap(await core.useCases.claimShip({ shipId: scoutId, secret, location: { kind: 'DEVICE' }, harness: 'claude-code' }));

    const listed = (await core.useCases.listFleet(argo)).find((ship) => ship.id === scoutId);
    expect(listed?.crewRequest).toMatchObject({ reason: 'no trierarch offers codex', crewedBy: { id: argo.shipId, name: 'argo' } });
    await expect(core.prisma.event.count({ where: { shipId: scoutId, type: 'CrewRequestExplained' } })).resolves.toBe(1);
  });

  it('is given back by its trierarch before its crew is final: unassigned, its lease ended, the trierarch kept until the next settings version (#382)', async () => {
    const { shipId: pluginId } = unwrap(
      await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'trierarch-plugin', type: 'plugin', fleetScopes: ['crew:assign'] }),
    );
    const { shipId: trierarchId } = unwrap(
      await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'mac-mini', type: 'trierarch', fleetScopes: ['crew:run'] }),
    );
    const plugin: Caller = { fleetId: argo.fleetId, shipId: pluginId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:assign'] };
    const trierarch: Caller = { fleetId: argo.fleetId, shipId: trierarchId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:run'] };
    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: { harness: 'claude-code', options: { model: 'claude-opus-5-5' } } }));
    unwrap(await core.useCases.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarchId }));
    unwrap(await core.useCases.reportCrewStatus(trierarch, { shipId: scoutId, status: 'crewing' }));
    const { secret } = unwrap(await core.useCases.getStartingPrompt(trierarch, { shipId: scoutId }));
    unwrap(await core.useCases.claimShip({ shipId: scoutId, secret, location: { kind: 'DEVICE' }, harness: 'claude-code' }));
    core.clock.advance(60_000);
    const reason = 'mac-mini: claude-code 2.1.293 refused claude-opus-5-5';

    unwrap(await core.useCases.giveBackCrewRequest(trierarch, { shipId: scoutId, settingsVersion: 1, reason }));

    const listed = (await core.useCases.listFleet(argo)).find((ship) => ship.id === scoutId);
    expect(listed).toMatchObject({ status: 'awaitingCrew' });
    expect(listed?.crewRequest).toMatchObject({
      assignedTo: null,
      status: null,
      givenBack: [{ trierarch: { id: trierarchId, name: 'mac-mini' }, settingsVersion: 1, reason, givenBackAt: core.clock.now() }],
    });
    await expect(core.prisma.event.count({ where: { shipId: scoutId, type: 'CrewRequestGivenBack' } })).resolves.toBe(1);
    await expect(core.useCases.giveBackCrewRequest(trierarch, { shipId: scoutId, settingsVersion: 1, reason })).resolves.toEqual({ isOk: true, value: undefined });

    unwrap(await core.useCases.requestCrew(argo, { shipId: scoutId, settings: { harness: 'claude-code' } }));
    await expect(core.useCases.listFleet(argo).then((ships) => ships.find((ship) => ship.id === scoutId)?.crewRequest?.givenBack)).resolves.toEqual([]);
  });
});
