import { describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';

describe('reading one ship as the fleet lists it', () => {
  it('gives the ship exactly as the fleet snapshot lists it', async () => {
    const core = createInMemoryCore('2026-09-29T12:00:00.000Z');
    const argo = operatorCaller(await initialiseFleet(core));
    const registry = registryUseCases(core);
    const { shipId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    const listed = (await registry.listFleet(argo)).find((ship) => ship.id === shipId);

    expect(unwrap(await registry.readListedShip(argo, { shipId }))).toEqual(listed);
  });

  it('refuses a ship the fleet does not hold', async () => {
    const core = createInMemoryCore('2026-09-29T12:00:00.000Z');
    const argo = operatorCaller(await initialiseFleet(core));

    await expect(registryUseCases(core).readListedShip(argo, { shipId: core.ids('ship') })).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_NOT_FOUND' } });
  });

  it("gives a ship outside the caller's read reach by its name, type and status only (decision 0034)", async () => {
    const fleet = await readReachScenario();
    await fleet.readRulesApply();
    const { status } = unwrap(await fleet.registry.readListedShip(fleet.argo, { shipId: fleet.far.shipId }));

    await expect(fleet.registry.readListedShip(fleet.reader, { shipId: fleet.far.shipId })).resolves.toEqual({
      isOk: true,
      value: { id: fleet.far.shipId, name: 'far', type: 'keeper', status, isInReadReach: false },
    });
  });
});
