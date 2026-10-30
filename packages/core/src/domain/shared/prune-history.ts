import type { FleetId, IdGenerator } from '@aeolus-fleet/common';

import { appliedLimits, type AppliedLimitsTx, type FleetRepository } from '../registry/public.js';
import type { Clock } from './clock.js';
import { recordEvent, SYSTEM, type EventLog } from './events.js';
import { isFinished, pruningCutoff, type HistoryPruner, type PruneCursor } from './history-pruning.js';
import { ok } from './result.js';
import type { UnitOfWork } from './unit-of-work.js';

const HOUR_MS = 60 * 60 * 1000;
/** How many messages, and how many rows of each other kind, one batch reads at most: each batch stays one short transaction. */
export const PRUNE_BATCH = 500;
/** How long one fleet's pass prunes before it leaves the rest to the next hour (R8). */
export const PRUNE_BUDGET_MS = 10_000;

export interface PruneHistoryTx extends AppliedLimitsTx {
  historyPruner: HistoryPruner;
  events: EventLog;
}

/** Prunes every due fleet; `onFleetError` (the pass always gives it) is told of a fleet whose pass threw, and the pass goes on with the next fleet. */
export type PruneHistory = (onFleetError?: (fleetId: FleetId, error: unknown) => void) => Promise<void>;

/** What one batch did: more may be left after its cursor, or none is. */
type Batch = { kind: 'more'; after: PruneCursor | null } | { kind: 'done' } | { kind: 'skipped' };

/**
 * Use case: the pruning pass (docs/design/retention/retention.md, R2 to R4,
 * R6 to R9, R12, R13 and R16), run by core in the 30 second pass after the
 * snapshot close, never through the API. A fleet with a retention whose last pass is an
 * hour old or more is claimed for this hour, then pruned in batches, each one
 * unit of work under the fleet's prune lock taken with try: a batch picks the
 * finished messages older than the cutoff, the mic and participant events of
 * meetings ended before it, and the rows that go by age past it (a crew's
 * session and secret events, ended leases, invalidated secrets, ended or
 * expired console sessions, used or expired sign-in tickets and reach refusals)
 * and the ships retired before it, which it removes (decision 0070), makes that
 * one set go and writes HistoryPruned. A batch that fails rolls back whole; a fleet another server
 * is pruning is skipped. Once nothing older than the cutoff is left, the
 * fleet's kept from moves to the cutoff; a pass whose time budget is spent
 * leaves the rest to the next hour.
 */
export function createPruneHistory(deps: {
  fleets: Pick<FleetRepository, 'list'>;
  uow: UnitOfWork<PruneHistoryTx>;
  clock: Clock;
  ids: IdGenerator;
  batch?: number;
  budgetMs?: number;
}): PruneHistory {
  const batchSize = deps.batch ?? PRUNE_BATCH;
  const budgetMs = deps.budgetMs ?? PRUNE_BUDGET_MS;

  const claim = (fleetId: FleetId) =>
    deps.uow.run(async (tx) => {
      const retentionDays = (await appliedLimits(tx, fleetId)).retention;
      const newestSnapshotHour = await tx.historyPruner.newestSnapshotHour(fleetId);
      if (retentionDays === null || newestSnapshotHour === undefined) {
        return ok(null);
      }
      const now = deps.clock.now();
      if (!(await tx.historyPruner.claimPass(fleetId, { at: now, dueBefore: new Date(now.getTime() - HOUR_MS) }))) {
        return ok(null);
      }
      return ok(pruningCutoff({ now, retentionDays, newestSnapshotHour }));
    });

  const pruneBatch = (fleetId: FleetId, input: { cutoff: Date; after: PruneCursor | null }) =>
    deps.uow.run(async (tx) => {
      const pruner = tx.historyPruner;
      if (!(await pruner.tryLock(fleetId))) {
        return ok<Batch>({ kind: 'skipped' });
      }
      const [candidates, meetingEventIds, shipIds] = await Promise.all([
        pruner.candidates(fleetId, { cutoff: input.cutoff, after: input.after, limit: batchSize }),
        pruner.meetingEvents(fleetId, { cutoff: input.cutoff, limit: batchSize }),
        pruner.retiredShips(fleetId, { cutoff: input.cutoff, limit: batchSize }),
      ]);
      const messageIds = candidates.filter(isFinished).map((candidate) => candidate.id);
      const aged = await pruner.agedRows(fleetId, { cutoff: input.cutoff, messageIds, limit: batchSize });
      const kinds = [meetingEventIds, shipIds, aged.eventIds, aged.leaseIds, aged.credentialIds, aged.consoleSessionIds, aged.signInTicketHashes, aged.reachRefusalIds];
      if (messageIds.length > 0 || kinds.some((rows) => rows.length > 0)) {
        const counts = await pruner.go(fleetId, { messageIds, meetingEventIds, shipIds, removedAt: deps.clock.now(), ...aged });
        await recordEvent(
          { events: tx.events, ids: deps.ids },
          { fleetId, type: 'HistoryPruned', occurredAt: deps.clock.now(), actor: SYSTEM, details: { cutoff: input.cutoff.toISOString(), ...counts } },
        );
      }
      const last = candidates.at(-1);
      const isMoreLeft = candidates.length === batchSize || kinds.some((rows) => rows.length === batchSize);
      return ok<Batch>(isMoreLeft ? { kind: 'more', after: last === undefined ? input.after : { createdAt: last.createdAt, id: last.id } } : { kind: 'done' });
    });

  const pruneFleet = async (fleetId: FleetId) => {
    const claimed = await claim(fleetId);
    const cutoff = claimed.isOk ? claimed.value : null;
    if (cutoff === null) {
      return;
    }
    const startedAt = deps.clock.now().getTime();
    let after: PruneCursor | null = null;
    for (;;) {
      const result = await pruneBatch(fleetId, { cutoff, after });
      const batch: Batch = result.isOk ? result.value : { kind: 'skipped' };
      if (batch.kind === 'skipped') {
        return;
      }
      if (batch.kind === 'done') {
        await deps.uow.run(async (tx) => {
          await tx.historyPruner.keepFrom(fleetId, cutoff);
          return ok(undefined);
        });
        return;
      }
      if (deps.clock.now().getTime() - startedAt >= budgetMs) {
        return;
      }
      after = batch.after;
    }
  };

  return async (onFleetError) => {
    for (const fleet of await deps.fleets.list()) {
      try {
        await pruneFleet(fleet.id);
      } catch (error) {
        onFleetError?.(fleet.id, error);
      }
    }
  };
}
