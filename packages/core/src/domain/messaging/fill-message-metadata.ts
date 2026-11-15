import type { FleetId } from '@aeolus-fleet/common';

import type { FleetRepository } from '../registry/public.js';
import { ok } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { MessageMetadataFill, MetadataFillIndexes } from './ports.js';

/** How many messages, and how many exchanges, one batch visits at most: each batch stays one short transaction. */
export const METADATA_FILL_BATCH = 100;

export interface FillMessageMetadataTx {
  messageMetadataFill: MessageMetadataFill;
}

/** One pass; `onFleetError` is told of a fleet whose batch threw, and the pass goes on with the next fleet. Resolves whether every fleet's fill is complete. */
export type FillMessageMetadata = (onFleetError?: (fleetId: FleetId, error: unknown) => void) => Promise<{ isComplete: boolean }>;

/**
 * Use case: the fill after start of the question ids and unseen plain message
 * counts the migrations only added (docs/architecture.md, Backfills), run by
 * core while it serves, never through the API. The first pass builds the
 * indexes the fill and the reads of its unfilled part use. Each pass then
 * takes one batch of each fleet, one unit of work under the fleet's cursor:
 * the next messages by id and the next exchanges by key, and the cursor with
 * them, so a batch that fails rolls back whole and the next pass takes it
 * again. A fleet is complete once both walks reached their end.
 */
export function createFillMessageMetadata(deps: {
  fleets: Pick<FleetRepository, 'list'>;
  indexes: MetadataFillIndexes;
  uow: UnitOfWork<FillMessageMetadataTx>;
  batch?: number;
}): FillMessageMetadata {
  const limit = deps.batch ?? METADATA_FILL_BATCH;
  let wasIndexBuildDone = false;

  const fillBatch = (fleetId: FleetId) =>
    deps.uow.run(async (tx) => {
      const fill = tx.messageMetadataFill;
      const cursor = await fill.lockCursor(fleetId);
      if (cursor.isComplete) {
        return ok(true);
      }
      const messageIds = await fill.fillQuestionIds(fleetId, { after: cursor.afterMessageId, limit });
      const exchanges = await fill.fillUnseenPlainMessages(fleetId, { after: cursor.afterExchange, limit });
      const isComplete = messageIds.length < limit && exchanges.length < limit;
      await fill.saveCursor(fleetId, {
        afterMessageId: messageIds.at(-1) ?? cursor.afterMessageId,
        afterExchange: exchanges.at(-1) ?? cursor.afterExchange,
        isComplete,
      });
      return ok(isComplete);
    });

  return async (onFleetError) => {
    if (!wasIndexBuildDone) {
      if (!await deps.indexes.build()) {
        return { isComplete: false };
      }
      wasIndexBuildDone = true;
    }
    let isComplete = true;
    for (const fleet of await deps.fleets.list()) {
      try {
        const batch = await fillBatch(fleet.id);
        isComplete = isComplete && batch.isOk && batch.value;
      } catch (error) {
        isComplete = false;
        onFleetError?.(fleet.id, error);
      }
    }
    return { isComplete };
  };
}
