/** Approved lookup scenarios at both ship doors and against indexed Postgres reads. */
import { idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, createPrismaClientTellingStatements, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaSnapshotUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createLookup } from '../src/domain/registry/lookup.js';
import { createPrismaLeaseRepository, createPrismaShipRepository } from '../src/adapters/prisma/registry.js';
import { createApp } from '../src/app.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases } from '../src/wiring.js';
import { assertIndexedPlan } from './support/assert-indexed-plan.js';
import { FLEET_URL, operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';

let databaseUrl: string;
let prisma: PrismaClient;
let server: FastifyInstance;
let address: string;
let caller: ShipCaller;
let fleetId: FleetId;
let crewToken: string;
let targetId: ShipId;
const SHIPS = 3_000;
const shipIdOf = (index: number) => idSchema('ship').parse(`shp_${String(index).padStart(26, '0')}`);

beforeAll(async () => {
  databaseUrl = await createMigratedDatabase();
  prisma = createPrismaClient(databaseUrl);
  const useCases = createUseCases({ prisma });
  const fleet = unwrap(await withOperatorLogin(prisma, useCases.initialiseFleet({ name: 'lookup fleet' })));
  fleetId = fleet.fleetId;
  caller = operatorCaller(fleet);
  const target = unwrap(await useCases.commissionShip(caller, { name: 'target', type: 'agent', note: 'Never a description.', idempotencyKey: newKey() }));
  targetId = target.shipId;
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, logger: false });
  address = await server.listen({ host: '127.0.0.1', port: 0 });
  const registered = await server.inject({ method: 'POST', url: '/api/v1/ship/register', payload: { shipId: targetId, secret: secretOf(target.secret), location: { kind: 'SERVER' } } });
  expect(registered.statusCode).toBe(200);
  crewToken = z.object({ crewToken: z.string() }).parse(registered.json()).crewToken;
  await prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    SELECT 'shp_' || lpad(i::text, 26, '0'), ${fleetId}, 'ship-' || i, 'agent', now(), 'agent', '{}'
    FROM generate_series(1, ${SHIPS}::int) i`;
  await prisma.$executeRaw`
    INSERT INTO leases (id, fleet_id, ship_id, location, started_at, ended_at, statement, statement_version)
    SELECT 'lse_' || lpad((i * 100 + n)::text, 26, '0'), ${fleetId}, 'shp_' || lpad(i::text, 26, '0'), 'SERVER'::location_kind,
      now() - interval '1 day', CASE WHEN n = 0 THEN NULL ELSE now() END,
      '{"summary":"  Keeps ships! More detail.","capabilities":[]}'::jsonb, 1
    FROM generate_series(1, ${SHIPS}::int) i, generate_series(0, 20) n`;
  if (process.env.AEOLUS_LOOKUP_SCALE === '1') {
    // Opt-in acceptance measurement, not a ten-million-row seed in ordinary CI.
    for (let batch = 0; batch < 10; batch += 1) {
      await prisma.$executeRaw`
        INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_ship_id, payload, content_type, idempotency_key, request_hash, created_at)
        SELECT 'msg_' || lpad(i::text, 26, '0'), ${fleetId}, ${targetId}, 'ship'::selector_kind, ${shipIdOf(1)}, 'retained message', 'text/plain', i::text, 'scale', now() - interval '30 days'
        FROM generate_series(${batch * 1_000_000 + 1}::int, ${(batch + 1) * 1_000_000}::int) i`;
    }
  }
  await prisma.$executeRaw`ANALYZE`;
}, 1_800_000);

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

async function restLookup(input: unknown, token = crewToken) {
  const response = await server.inject({ method: 'POST', url: '/api/v1/ship/lookup', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, payload: JSON.stringify(input) });
  return { statusCode: response.statusCode, body: response.body };
}

describe('ship.lookup through REST and MCP (#1911)', () => {
  it('answers the same narrow header through both doors', async () => {
    const input = { name: 'ship-1' };
    const expected = { id: shipIdOf(1), name: 'ship-1', description: 'Keeps ships!' };
    const client = new Client({ name: 'lookup-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`)));
    try {
      const rest = await restLookup(input);
      const mcp = await client.callTool({ name: 'lookup', arguments: { ...input, crewToken } });

      expect(rest.statusCode).toBe(200);
      expect(JSON.parse(rest.body)).toEqual(expected);
      expect(mcp.structuredContent).toEqual(expected);
    } finally {
      await client.close();
    }
  });

  it.each([{}, { id: shipIdOf(1), name: 'ship-1' }, { id: 'invalid' }, { name: '' }, { name: 'ship-1', fleetId: 'another' }])('refuses invalid input %j', async (input) => {
    const response = await restLookup(input);

    expect(response.statusCode).toBe(400);
  });

  it('uses current send scope and credentials, never read scope as a substitute', async () => {
    const invalid = await restLookup({ name: 'ship-1' }, 'invalid');
    await prisma.ship.update({ where: { id: targetId }, data: { scopes: ['fleet:read'] } });
    try {
      const noSend = await restLookup({ name: 'ship-1' });

      expect(invalid.statusCode).toBe(401);
      expect(noSend.statusCode).toBe(403);
    } finally {
      await prisma.ship.update({ where: { id: targetId }, data: { scopes: ['messages:send', 'messages:receive'] } });
    }
  });

  it('reads only the current lease and returns null without a statement or visible candidate', async () => {
    const lookup = createLookup({ uow: createPrismaSnapshotUnitOfWork(prisma) });
    const noStatement = unwrap(await lookup(caller, { id: targetId }));
    await prisma.lease.updateMany({ where: { fleetId, shipId: shipIdOf(1), endedAt: null }, data: { endedAt: new Date() } });
    try {
      const ended = unwrap(await lookup(caller, { id: shipIdOf(1) }));
      const missing = await restLookup({ name: 'absent' });
      const self = await restLookup({ id: targetId });

      expect(noStatement).toEqual({ id: targetId, name: 'target', description: null });
      expect(ended).toEqual({ id: shipIdOf(1), name: 'ship-1', description: null });
      expect(JSON.parse(missing.body)).toBeNull();
      expect(JSON.parse(self.body)).toBeNull();
    } finally {
      await prisma.$executeRaw`UPDATE leases SET ended_at = NULL WHERE fleet_id = ${fleetId} AND id = 'lse_00000000000000000000000100'`;
    }
  });

  it('uses indexed candidate and open-lease reads with 3,000 ships and 60,000 ended leases', async () => {
    const statements: { query: string; params: string }[] = [];
    const client = createPrismaClientTellingStatements(databaseUrl, (query, params) => statements.push({ query, params }));
    try {
      const ships = createPrismaShipRepository(client);
      const leases = createPrismaLeaseRepository(client);
      await ships.find(fleetId, shipIdOf(1));
      await ships.findActiveByName(fleetId, 'ship-1');
      await leases.findOpenSummary(fleetId, shipIdOf(1));
      const reads = statements.filter(({ query }) => /^\s*SELECT/i.test(query));

      expect(reads).toHaveLength(3);
      for (const statement of reads) {
        const plan = await assertIndexedPlan(prisma, statement);
        expect(plan).not.toMatch(/"Node Type": "Seq Scan"/);
        expect(plan).toMatch(/Index/);
        // Only this client's captured, parameterized reads are executed here.
        const analyzed: unknown = await prisma.$queryRawUnsafe('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + statement.query,
          ...z.array(z.union([z.string(), z.number(), z.null()])).parse(JSON.parse(statement.params)));
        console.info('lookup plan', JSON.stringify(analyzed));
      }
    } finally {
      await client.$disconnect();
    }
  });
});


describe.runIf(process.env.AEOLUS_LOOKUP_SCALE === '1')('lookup acceptance measurement', () => {
  it('meets p95 <100 ms, p99 <500 ms and errors <1% at 3,000 ships and 10,000,000 messages', async () => {
    const durations: number[] = [];
    let errors = 0;
    for (let index = 0; index < 520; index += 1) {
      const started = performance.now();
      const response = await restLookup(index % 2 === 0 ? { id: shipIdOf(index % SHIPS + 1) } : { name: `ship-${index % SHIPS + 1}` });
      if (index >= 20) {
        durations.push(performance.now() - started);
        if (response.statusCode !== 200) errors += 1;
      }
    }
    durations.sort((first, second) => first - second);
    const p95 = durations[474] ?? Infinity;
    const p99 = durations[494] ?? Infinity;
    const errorRate = errors / durations.length;

    console.info(JSON.stringify({ ships: SHIPS, messages: 10_000_000, endedLeases: 60_000, samples: durations.length, p95, p99, errorRate }));
    expect(p95).toBeLessThan(100);
    expect(p99).toBeLessThan(500);
    expect(errorRate).toBeLessThan(0.01);
  }, 120_000);
});
