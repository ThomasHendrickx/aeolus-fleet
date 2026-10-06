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
let plugin: Caller;
let scoutId: ShipId;

const NO_ROOM = 'no trierarch offers codex with room';

beforeEach(async () => {
  core = createInMemoryCore('2026-10-06T18:40:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  plugin = await shipWithScopes({ registry, argo }, { name: 'navarch', type: 'navarch', scopes: ['crew:assign'] });
  ({ shipId: scoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  unwrap(await registry.requestCrew(argo, { shipId: scoutId, settings: { harness: 'codex' } }));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

function reasonOf(shipId: ShipId) {
  return core.state.crewRequests.find((request) => request.fleetId === fleetId && request.shipId === shipId)?.reason;
}

describe('the reason on an unassigned crew request', () => {
  it('is none before the assigner writes one', () => {
    expect(reasonOf(scoutId)).toBeNull();
  });

  it('is what the assigner writes: why no trierarch can take it', async () => {
    await expect(registry.explainCrewRequest(plugin, { shipId: scoutId, reason: NO_ROOM })).resolves.toEqual({ isOk: true, value: undefined });

    expect(reasonOf(scoutId)).toBe(NO_ROOM);
  });

  it('writes CrewRequestExplained, caused by the assigner, with the reason', async () => {
    unwrap(await registry.explainCrewRequest(plugin, { shipId: scoutId, reason: NO_ROOM }));

    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'CrewRequestExplained', actor: { kind: 'ship', shipId: plugin.shipId }, shipId: scoutId, details: { reason: NO_ROOM } }),
    ]);
  });

  it('writes no event when the reason stays the same', async () => {
    unwrap(await registry.explainCrewRequest(plugin, { shipId: scoutId, reason: NO_ROOM }));
    core.state.events.length = 0;

    unwrap(await registry.explainCrewRequest(plugin, { shipId: scoutId, reason: NO_ROOM }));

    expect(core.state.events).toEqual([]);
  });

  it('is cleared with null', async () => {
    unwrap(await registry.explainCrewRequest(plugin, { shipId: scoutId, reason: NO_ROOM }));

    unwrap(await registry.explainCrewRequest(plugin, { shipId: scoutId, reason: null }));

    expect(reasonOf(scoutId)).toBeNull();
  });

  it('is cleared when the request is assigned', async () => {
    const trierarch = await shipWithScopes({ registry, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
    unwrap(await registry.explainCrewRequest(plugin, { shipId: scoutId, reason: NO_ROOM }));

    unwrap(await registry.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarch.shipId }));

    expect(reasonOf(scoutId)).toBeNull();
  });

  it('is listed with the ship', async () => {
    unwrap(await registry.explainCrewRequest(plugin, { shipId: scoutId, reason: NO_ROOM }));

    const listed = (await registry.listFleet(argo)).find((ship) => ship.id === scoutId);

    expect(listed?.crewRequest).toMatchObject({ reason: NO_ROOM });
  });
});

describe('a reason refused', () => {
  async function expectRefused(input: Parameters<typeof registry.explainCrewRequest>[1], kind: string): Promise<void> {
    const before = structuredClone(core.state);

    await expect(registry.explainCrewRequest(plugin, input)).resolves.toMatchObject({ isOk: false, error: { kind } });

    expect(core.state).toEqual(before);
  }

  it('refuses a request that is assigned already', async () => {
    const trierarch = await shipWithScopes({ registry, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
    unwrap(await registry.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarch.shipId }));
    core.state.events.length = 0;

    await expectRefused({ shipId: scoutId, reason: NO_ROOM }, 'CREW_REQUEST_ALREADY_ASSIGNED');
  });

  it('refuses a reason over 200 characters', async () => {
    await expectRefused({ shipId: scoutId, reason: 'x'.repeat(201) }, 'INVALID_CREW_REQUEST_REASON');
  });

  it('refuses a reason over one line', async () => {
    await expectRefused({ shipId: scoutId, reason: 'no room\non any machine' }, 'INVALID_CREW_REQUEST_REASON');
  });

  it('refuses a ship without a crew request', async () => {
    unwrap(await registry.removeCrewRequest(argo, { shipId: scoutId }));
    core.state.events.length = 0;

    await expectRefused({ shipId: scoutId, reason: NO_ROOM }, 'CREW_REQUEST_NOT_FOUND');
  });
});
