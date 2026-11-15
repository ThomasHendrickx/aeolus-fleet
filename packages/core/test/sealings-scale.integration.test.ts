/** The plain payload check uses the partial index on a fleet's message history (#1854). */
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createPrismaClientTellingStatements } from '../src/adapters/prisma/client.js';
import { createPrismaFleetSealingRepository } from '../src/adapters/prisma/sealings.js';
import { assertIndexedPlan } from './support/assert-indexed-plan.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { seedScaleFleet } from './support/scale-fleet.js';

let core: PostgresCore;
let fleetId: Awaited<ReturnType<typeof seedScaleFleet>>['fleetId'];

beforeAll(async () => {
  core = await createPostgresCore();
  ({ fleetId } = await seedScaleFleet(core));
  await core.prisma.$executeRaw`CREATE INDEX IF NOT EXISTS messages_plain_payload_idx ON messages (fleet_id, created_at, id) WHERE payload IS NOT NULL`;
  await core.prisma.$executeRaw`ANALYZE messages`;
}, 300_000);

afterAll(async () => {
  await core.close();
});

it('checks for a plain payload through the partial index on a busy fleet', async () => {
  // Given a fleet with a large message history and the plain payload index.
  const statements: { query: string; params: string }[] = [];
  const client = createPrismaClientTellingStatements(core.databaseUrl, (query, params) => {
    statements.push({ query, params });
  });
  try {
    // When the sealing repository checks whether the fleet stores a plain payload.
    expect(await createPrismaFleetSealingRepository(client).storesPlainPayload(fleetId)).toBe(true);

    // Then its message query uses the partial index without scanning message history.
    const reads = statements.filter(({ query }) => query.includes('SELECT id FROM messages') && query.includes('payload IS NOT NULL'));
    expect(reads).toHaveLength(1);
    for (const statement of reads) {
      expect(await assertIndexedPlan(core.prisma, statement)).toContain('messages_plain_payload_idx');
    }
  } finally {
    await client.$disconnect();
  }
});
