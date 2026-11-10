import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { CREW_DESCRIPTION_FIXTURES } from './support/crew-description-fixtures.js';

let prisma: PrismaClient;
beforeAll(async () => { prisma = createPrismaClient(await createMigratedDatabase()); });
afterAll(async () => { await prisma.$disconnect(); });

describe('crew description in PostgreSQL', () => {
  it.each(CREW_DESCRIPTION_FIXTURES)('projects only the authorized first sentence of %j', async (summary, expected) => {
    // Given the same approved summary examples as the pure domain helper.
    const statement = summary === null ? null : JSON.stringify({ summary });

    // When PostgreSQL projects the description used by display and search indexes.
    const rows = await prisma.$queryRaw<{ description: string | null }[]>`SELECT crew_description(${statement}::jsonb) AS description`;

    // Then its punctuation, whitespace and null behavior match the approved examples.
    expect(rows).toEqual([{ description: expected }]);
  });
});
