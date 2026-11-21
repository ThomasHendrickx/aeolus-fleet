import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { addAgentShip, crewAboard, deliveryInFlight, initialiseFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore, type InMemoryTx } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { createCreateFleet } from './create-fleet.js';
import { createDeleteFleet } from './delete-fleet.js';
import { createRemoveDeletedFleets, type RemoveDeletedFleetsTx } from './remove-deleted-fleets.js';

let core: InMemoryCore;
let doomed: FleetId;

/** Rows the fleet still has anywhere, fleet row included. */
const left = (): number => core.state.fleets.filter((fleet) => fleet.id === doomed).length + core.state.messages.length + core.state.deliveries.length + core.state.events.filter((event) => event.fleetId === doomed).length;

/** The removal's steps, as a unit of work fails them: `at` counts the calls of `step` from 1. */
type Step = 'removeHistoryBatch' | 'removeRest';
function failing(step: Step, at: number): UnitOfWork<RemoveDeletedFleetsTx> {
  let calls = 0;
  return {
    run: (work) =>
      core.uow.run(async (tx: InMemoryTx) =>
        work({
          ships: tx.ships,
          fleetRemoval: {
            ...tx.fleetRemoval,
            removeHistoryBatch: (...args) => {
              if (step === 'removeHistoryBatch' && (calls += 1) === at) {
                return Promise.reject(new Error('the database went away'));
              }
              return tx.fleetRemoval.removeHistoryBatch(...args);
            },
            removeRest: (...args) => {
              if (step === 'removeRest' && (calls += 1) === at) {
                return Promise.reject(new Error('the database went away'));
              }
              return tx.fleetRemoval.removeRest(...args);
            },
          },
        }),
      ),
  };
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-04T12:00:00.000Z');
  await initialiseFleet(core);
  ({ fleetId: doomed } = unwrap(
    await createCreateFleet({ uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher })({ requestId: 'signup-1', name: 'hemma', operatorEmail: 'lena@example.com' }),
  ));
  for (const name of ['scout', 'lookout', 'cook']) {
    const ship = addAgentShip(core, { fleetId: doomed, name });
    deliveryInFlight(core, { fleetId: doomed, shipId: ship.shipId, leaseId: crewAboard(core, { fleetId: doomed, shipId: ship.shipId }).leaseId });
  }
  unwrap(await createDeleteFleet({ uow: core.uow, clock: core.clock, hasher: core.hasher })({ requestId: 'delete-1', fleetId: doomed }));
});

describe('a removal that fails, then is run again (decision 0020)', () => {
  it.each([
    { when: 'at its first batch', step: 'removeHistoryBatch', at: 1 },
    { when: 'part way', step: 'removeHistoryBatch', at: 3 },
    { when: 'just before its last step', step: 'removeRest', at: 1 },
  ] as const)('goes on until the fleet is gone when it fails $when', async ({ step, at }) => {
    const failures: FleetId[] = [];

    await createRemoveDeletedFleets({ fleets: core.fleets, uow: failing(step, at), clock: core.clock, batch: 1 })((fleetId) => failures.push(fleetId));

    expect(failures).toEqual([doomed]);
    expect(left()).toBeGreaterThan(0);
    expect(await core.fleets.listDeleted()).toHaveLength(1);

    await createRemoveDeletedFleets({ fleets: core.fleets, uow: core.uow, clock: core.clock, batch: 1 })();

    expect(left()).toBe(0);
    expect(await core.fleets.listDeleted()).toEqual([]);
  });

  it('leaves the rest to the next pass when its time budget is spent, and that pass finishes it', async () => {
    await createRemoveDeletedFleets({ fleets: core.fleets, uow: core.uow, clock: core.clock, batch: 1, budgetMs: 0 })();
    expect(left()).toBeGreaterThan(0);

    await createRemoveDeletedFleets({ fleets: core.fleets, uow: core.uow, clock: core.clock, batch: 1 })();

    expect(left()).toBe(0);
  });
});
