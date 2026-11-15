import type { FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { createInMemoryMetadataFill, type InMemoryMetadataFill } from '../../../test/support/in-memory-message-metadata-fill.js';
import { createFillMessageMetadata } from './fill-message-metadata.js';

const HOME: FleetId = 'flt_01home0000000000000000000';
const AWAY: FleetId = 'flt_01away0000000000000000000';

function fillOf(fill: InMemoryMetadataFill, batch: number) {
  return createFillMessageMetadata({ fleets: fill.fleets, indexes: fill.indexes, uow: fill.uow, batch });
}

/** Passes until one says the fill is complete, at most `most` times; how many it took. */
async function passUntilComplete(pass: ReturnType<typeof fillOf>, most: number): Promise<number> {
  for (let passes = 1; passes <= most; passes += 1) {
    if ((await pass()).isComplete) {
      return passes;
    }
  }
  return Number.POSITIVE_INFINITY;
}

describe('the metadata fill after start (docs/architecture.md, Backfills)', () => {
  it('builds the indexes once, before the first batch, then fills one batch per fleet per pass', async () => {
    // Given two fleets with old messages and exchanges.
    const fill = createInMemoryMetadataFill([{ fleetId: HOME, messages: 5, exchanges: 1 }, { fleetId: AWAY, messages: 1, exchanges: 1 }]);
    const pass = fillOf(fill, 2);

    // When core passes twice.
    await pass();
    await pass();

    // Then the indexes were built first and once, and each pass took one batch of each fleet.
    expect(fill.ran).toEqual(['indexes', HOME, AWAY, HOME, AWAY]);
    expect(fill.filled(HOME).messageIds).toEqual(fill.stored(HOME).messageIds.slice(0, 4));
  });

  it('walks the exchanges by their own key, so one is filled however its newest message moved, and is complete only once both walks ended', async () => {
    // Given a fleet with few messages and more exchanges than one batch holds.
    const fill = createInMemoryMetadataFill([{ fleetId: HOME, messages: 1, exchanges: 5 }]);

    // When core passes until the fill says it is complete.
    const passes = await passUntilComplete(fillOf(fill, 2), 10);

    // Then it went on past the messages' end until every exchange was visited.
    expect(passes).toBe(3);
    expect(fill.filled(HOME)).toEqual(fill.stored(HOME));
    expect(fill.cursorOf(HOME)).toEqual({ afterMessageId: fill.stored(HOME).messageIds.at(-1), afterExchange: fill.stored(HOME).exchanges.at(-1), isComplete: true });
  });

  it('is complete only when every fleet is', async () => {
    // Given one fleet with one batch and one with three.
    const fill = createInMemoryMetadataFill([{ fleetId: HOME, messages: 1, exchanges: 0 }, { fleetId: AWAY, messages: 5, exchanges: 0 }]);
    const pass = fillOf(fill, 2);

    // When core passes.
    const passes = [await pass(), await pass(), await pass()];

    // Then the fill went on for the longer fleet and the finished fleet was not walked again.
    expect(passes.map((outcome) => outcome.isComplete)).toEqual([false, false, true]);
    expect(fill.ran).toEqual(['indexes', HOME, AWAY, HOME, AWAY, HOME, AWAY]);
    expect(fill.filled(AWAY)).toEqual(fill.stored(AWAY));
  });

  it('rolls a failed batch back with its cursor, tells of the fleet, fills the next fleet, and takes the batch again next pass', async () => {
    // Given two fleets, the first one's next batch failing.
    const fill = createInMemoryMetadataFill([{ fleetId: HOME, messages: 1, exchanges: 1 }, { fleetId: AWAY, messages: 1, exchanges: 1 }]);
    const pass = fillOf(fill, 2);
    const failures: FleetId[] = [];
    fill.failNextBatchOf(HOME);

    // When core passes twice.
    const first = await pass((fleetId) => failures.push(fleetId));
    const rolledBack = fill.filled(HOME);
    const second = await pass((fleetId) => failures.push(fleetId));

    // Then the failed fleet kept no cursor and was not complete, the other was filled, and the retry filled the first.
    expect(failures).toEqual([HOME]);
    expect(rolledBack).toEqual({ messageIds: [], exchanges: [] });
    expect(fill.cursorOf(HOME)).toEqual({ afterMessageId: fill.stored(HOME).messageIds.at(-1), afterExchange: fill.stored(HOME).exchanges.at(-1), isComplete: true });
    expect(first.isComplete).toBe(false);
    expect(fill.filled(AWAY)).toEqual(fill.stored(AWAY));
    expect(second.isComplete).toBe(true);
    expect(fill.filled(HOME)).toEqual(fill.stored(HOME));
  });

  it('fills nothing while the indexes are not built, and builds them again next pass', async () => {
    // Given the index build fails once.
    const fill = createInMemoryMetadataFill([{ fleetId: HOME, messages: 1, exchanges: 1 }]);
    const pass = fillOf(fill, 2);
    fill.failNextBuild();

    // When core passes twice.
    await expect(pass()).rejects.toThrow('the index build failed');
    const second = await pass();

    // Then the first pass filled nothing and the second built the indexes, then filled.
    expect(fill.ran).toEqual(['indexes', 'indexes', HOME]);
    expect(second.isComplete).toBe(true);
  });
});
