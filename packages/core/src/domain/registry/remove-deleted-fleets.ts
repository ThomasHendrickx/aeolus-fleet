import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { ok } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { FleetRemoval, FleetRepository } from './ports.js';

/** How many rows of one kind a batch removes at most, as the pruning pass reads (500): each batch stays one short transaction. */
export const REMOVAL_BATCH = 500;
/** How long one fleet's removal runs in a pass before it leaves the rest to the next pass. */
export const REMOVAL_BUDGET_MS = 10_000;

export interface RemoveDeletedFleetsTx {
  fleetRemoval: FleetRemoval;
}

/** Removes every fleet marked deleted; `onFleetError` is told of a fleet whose removal threw, and the pass goes on with the next fleet. */
export type RemoveDeletedFleets = (onFleetError?: (fleetId: FleetId, error: unknown) => void) => Promise<void>;

/**
 * Use case: the removal pass (decision 0020), run by core in the 30 second
 * pass, never through the API. It starts from the rows a fleet marked deleted
 * still has, so whatever stopped it, a failed batch, a failed last step or a
 * restart, the next pass goes on until the fleet is gone. Each fleet's history,
 * then its other records, go in batches, each one unit of work under the
 * fleet's removal lock taken with try (a fleet another server is removing is
 * skipped); then one unit of work removes the fleet itself. A pass whose time budget is spent
 * leaves the rest to the next pass.
 */
export function createRemoveDeletedFleets(deps: {
  fleets: Pick<FleetRepository, 'listDeleted'>;
  uow: UnitOfWork<RemoveDeletedFleetsTx>;
  clock: Clock;
  batch?: number;
  budgetMs?: number;
}): RemoveDeletedFleets {
  const batchSize = deps.batch ?? REMOVAL_BATCH;
  const budgetMs = deps.budgetMs ?? REMOVAL_BUDGET_MS;

  const removeOne = async (fleetId: FleetId): Promise<void> => {
    const startedAt = deps.clock.now().getTime();
    for (const step of ['removeHistoryBatch', 'removeRecordsBatch'] as const) {
      for (;;) {
        const result = await deps.uow.run(async (tx) => ok((await tx.fleetRemoval.tryLock(fleetId)) ? await tx.fleetRemoval[step](fleetId, batchSize) : 'locked'));
        const batch = result.isOk ? result.value : 'locked';
        if (batch === 'locked') {
          return;
        }
        if (batch === 'empty') {
          break;
        }
        if (deps.clock.now().getTime() - startedAt >= budgetMs) {
          return;
        }
      }
    }
    await deps.uow.run(async (tx) => {
      if (await tx.fleetRemoval.tryLock(fleetId)) {
        await tx.fleetRemoval.removeRest(fleetId);
      }
      return ok(undefined);
    });
  };

  return async (onFleetError) => {
    for (const fleet of await deps.fleets.listDeleted()) {
      try {
        await removeOne(fleet.id);
      } catch (error) {
        onFleetError?.(fleet.id, error);
      }
    }
  };
}
