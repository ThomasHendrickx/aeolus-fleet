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

  it('keeps activity time covering the ordered partial index rather than adding an ordering key', async () => {
    // Given the approved activity lookup at retained-history scale.
    // When PostgreSQL describes the committed index, independently of Prisma metadata.
    const rows = await prisma.$queryRaw<{ keys: number; attributes: number; definition: string }[]>`
      SELECT i.indnkeyatts::int AS keys, i.indnatts::int AS attributes,
             pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'events_person_activity_idx'`;

    // Then only fleet, actor and sequence order the index; time is included for the projection.
    expect(rows.map(({ keys, attributes }) => ({ keys, attributes }))).toEqual([{ keys: 3, attributes: 4 }]);
    expect(rows[0]?.definition).toContain('INCLUDE (occurred_at)');
  });

});
