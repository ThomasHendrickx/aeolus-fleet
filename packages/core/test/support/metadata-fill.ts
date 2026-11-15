/** The metadata fill as core wires it, with a batch size of the test's choice. */
import type { FleetId } from '@aeolus-fleet/common';
import { expect } from 'vitest';

import type { PrismaClient } from '../../src/adapters/prisma/client.js';
import { createPrismaMetadataFillIndexes } from '../../src/adapters/prisma/message-metadata-fill.js';
import { createPrismaFleetRepository } from '../../src/adapters/prisma/registry.js';
import { createPrismaUnitOfWork } from '../../src/adapters/prisma/unit-of-work.js';
import { createFillMessageMetadata, type FillMessageMetadata } from '../../src/domain/messaging/fill-message-metadata.js';

export function metadataFillOf(prisma: PrismaClient, batch?: number): FillMessageMetadata {
  return createFillMessageMetadata({ fleets: createPrismaFleetRepository(prisma), indexes: createPrismaMetadataFillIndexes(prisma), uow: createPrismaUnitOfWork(prisma), ...(batch === undefined ? {} : { batch }) });
}

/** Passes until the fill is complete, each pass a new one that reads the cursors the last committed; fails a pass that throws for a fleet. */
export async function fillUntilComplete(prisma: PrismaClient, batch?: number): Promise<void> {
  const failures: { fleetId: FleetId; error: unknown }[] = [];
  let isComplete = false;
  for (let passes = 0; passes < 1_000 && !isComplete && failures.length === 0; passes += 1) {
    ({ isComplete } = await metadataFillOf(prisma, batch)((fleetId, error) => failures.push({ fleetId, error })));
  }
  expect(failures).toEqual([]);
  expect(isComplete).toBe(true);
}
