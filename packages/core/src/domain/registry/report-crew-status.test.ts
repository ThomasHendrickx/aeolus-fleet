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
  const plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] });
  trierarch = await shipWithScopes({ registry, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
  ({ shipId: scoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings: { harness: 'claude-code' } }));
  unwrap(await registry.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarch.shipId }));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

function statusOf(shipId: ShipId) {
  return core.state.crewRequests.find((request) => request.fleetId === fleetId && request.shipId === shipId)?.status;
}

describe("the assigned trierarch's status", () => {
  it.each(['crewing', 'running', 'restarting', 'crashed', 'releasing'] as const)('is %s when the trierarch writes it', async (status) => {
    await expect(registry.reportCrewStatus(trierarch, { shipId: scoutId, status })).resolves.toEqual({ isOk: true, value: undefined });

    expect(statusOf(scoutId)).toBe(status);
  });

  it('writes CrewStatusChanged, caused by the trierarch, with the status', async () => {
    unwrap(await registry.reportCrewStatus(trierarch, { shipId: scoutId, status: 'crewing' }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'CrewStatusChanged',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: trierarch.shipId },
        shipId: scoutId,
        details: { status: 'crewing', attempt: 0 },
      }),
    ]);
  });

  it('keeps the restart attempt and when the session started, with the status (#332)', async () => {
    const startedAt = '2026-10-06T17:00:30.000Z';

    unwrap(await registry.reportCrewStatus(trierarch, { shipId: scoutId, status: 'restarting', attempt: 2, startedAt }));

    expect(core.state.crewRequests.find((request) => request.shipId === scoutId)).toMatchObject({ status: 'restarting', attempt: 2, sessionStartedAt: new Date(startedAt) });
  });

  it('counts a status without them as the first start, with no session running', async () => {
    unwrap(await registry.reportCrewStatus(trierarch, { shipId: scoutId, status: 'restarting', attempt: 2, startedAt: '2026-10-06T17:00:30.000Z' }));

    unwrap(await registry.reportCrewStatus(trierarch, { shipId: scoutId, status: 'crewing' }));

    expect(core.state.crewRequests.find((request) => request.shipId === scoutId)).toMatchObject({ status: 'crewing', attempt: 0, sessionStartedAt: null });
  });

  it('writes CrewStatusChanged when only the attempt moves, with the attempt', async () => {
    unwrap(await registry.reportCrewStatus(trierarch, { shipId: scoutId, status: 'restarting', attempt: 1 }));
    core.state.events.length = 0;

    unwrap(await registry.reportCrewStatus(trierarch, { shipId: scoutId, status: 'restarting', attempt: 2 }));

    expect(core.state.events).toEqual([expect.objectContaining({ type: 'CrewStatusChanged', details: { status: 'restarting', attempt: 2 } })]);
  });

  it('writes no event when the status stays the same', async () => {
    unwrap(await registry.reportCrewStatus(trierarch, { shipId: scoutId, status: 'running' }));
    core.state.events.length = 0;

    unwrap(await registry.reportCrewStatus(trierarch, { shipId: scoutId, status: 'running' }));

    expect(core.state.events).toEqual([]);
  });
});

describe('a status refused', () => {
  async function expectRefused({ caller, input }: { caller: Caller; input: Parameters<typeof registry.reportCrewStatus>[1] }, kind: string): Promise<void> {
    const before = structuredClone(core.state);

    await expect(registry.reportCrewStatus(caller, input)).resolves.toMatchObject({ isOk: false, error: { kind } });

    expect(core.state).toEqual(before);
  }

  it('refuses a trierarch the request is not assigned to', async () => {
    const other = await shipWithScopes({ registry, argo }, { name: 'linux-box', type: 'trierarch', scopes: ['crew:run'] });
    core.state.events.length = 0;

    await expectRefused({ caller: other, input: { shipId: scoutId, status: 'running' } }, 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER');
  });

  it('refuses any status but releasing once the request is releasing', async () => {
    unwrap(await registry.removeCrewRequest(argo, { shipId: scoutId }));
    core.state.events.length = 0;

    await expectRefused({ caller: trierarch, input: { shipId: scoutId, status: 'running' } }, 'CREW_REQUEST_RELEASING');
  });

  it('refuses a ship without a crew request', async () => {
    unwrap(await registry.retireShip(argo, { shipId: scoutId }));
    core.state.events.length = 0;

    await expectRefused({ caller: trierarch, input: { shipId: scoutId, status: 'running' } }, 'CREW_REQUEST_NOT_FOUND');
  });
});
