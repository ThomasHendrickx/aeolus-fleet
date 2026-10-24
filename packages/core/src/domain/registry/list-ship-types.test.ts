import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: ShipCaller;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-24T12:00:00.000Z');
  argo = operatorCaller(await initialiseFleet(core));
  registry = registryUseCases(core);
  for (const [name, type] of [['scout', 'reviewer'], ['builder', 'implementer'], ['checker', 'reviewer']] as const) {
    unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name, type }));
  }
  const { shipId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'old', type: 'archivist' }));
  unwrap(await registry.retireShip(argo, { shipId }));
});

describe("the fleet's ship types (the overview's Type filter)", () => {
  it('answers each type of the active ships once, sorted', async () => {
    await expect(registry.listShipTypes(argo)).resolves.toEqual(['implementer', 'operator', 'reviewer']);
  });

  it('answers the types of retired ships too when the status asks for retired', async () => {
    await expect(registry.listShipTypes(argo, { status: ['awaitingCrew', 'crewed', 'retired'] })).resolves.toEqual(['archivist', 'implementer', 'operator', 'reviewer']);
  });

  it('answers only the types of the statuses asked', async () => {
    await expect(registry.listShipTypes(argo, { status: ['retired'] })).resolves.toEqual(['archivist']);
  });
});

describe("the fleet's ship types within read reach (decision 0034)", () => {
  it('answers only the types of the ships the caller reads', async () => {
    const fleet = await readReachScenario();
    await fleet.readRulesApply();

    const types = await fleet.registry.listShipTypes(fleet.reader);
    const read = (await fleet.registry.listFleet(fleet.reader)).ships.filter((ship) => !('isInReadReach' in ship)).map((ship) => ship.type);

    expect(types).toEqual([...new Set(read)].toSorted());
  });
});
