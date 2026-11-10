import { idSchema, personShipCursorOf, type PersonShipPageInput, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClientTellingStatements, type PrismaClient } from '../src/adapters/prisma/client.js';
import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { createPrismaPersonReadUnitOfWork } from '../src/adapters/prisma/person-read-unit-of-work.js';
import { personShipPageStatement } from '../src/adapters/prisma/person-ship-page.js';
import { createPrismaPersonShipReadTx } from '../src/adapters/prisma/person-ship-reads.js';
import { personShipReportsStatement } from '../src/adapters/prisma/person-ship-reports.js';
import type { PersonShipReadTx } from '../src/domain/registry/person-ship-reads.js';
import { unwrap } from '../src/testing/result.js';
import { aPersonReadFleet, personReadsOf } from './support/person-read-postgres.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

// Bounded core proof only. This does not replace the integrated app/gateway/core
// staging proof with 10,000,000 retained messages or measure network latency.
const SHIPS = 3000;
const SAMPLES = 30;
const seededId = (number: number): ShipId => idSchema('ship').parse(`shp_0${String(number).padStart(25, '0')}`);
let core: PostgresCore;
let fleet: Awaited<ReturnType<typeof aPersonReadFleet>>;
let measured: PrismaClient;
let statements: string[] = [];
let projections: Prisma.Sql[] = [];
let reportIds: readonly ShipId[] = [];
let reads: ReturnType<typeof personReadsOf>;

beforeAll(async () => {
  core = await createPostgresCore();
  fleet = await aPersonReadFleet(core);
  const other = await aPersonReadFleet(core);
  // Many fleets and retained rows make a global/history scan visible to EXPLAIN.
  await core.prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes, retired_at)
    SELECT 'shp_' || prefix || lpad(i::text, 25, '0'), tenant, 'common-' || lpad(i::text, 5, '0'), 'builder', now(), 'agent', '{}', ended
    FROM (VALUES ('0', ${fleet.fleetId}, NULL::timestamptz, ${SHIPS}),
                 ('1', ${fleet.fleetId}, now(), 30000), ('2', ${other.fleetId}, NULL::timestamptz, 30000)) seed(prefix, tenant, ended, size)
    CROSS JOIN LATERAL generate_series(1, size) i`;
  await core.prisma.$executeRaw`
    INSERT INTO leases (id, fleet_id, ship_id, location, started_at, ended_at, statement, report_state, report_note, activity_at)
    SELECT 'lse_' || prefix || lpad(i::text, 25, '0'), tenant, 'shp_' || prefix || lpad(i::text, 25, '0'), 'DEVICE', now(), ended,
           jsonb_build_object('summary', CASE WHEN i = 2800 THEN 'Needle description. Hidden.' ELSE 'Common first sentence. Hidden.' END, 'capabilities', '[]'::jsonb),
           'working', 'bounded note', now()
    FROM (VALUES ('0', ${fleet.fleetId}, NULL::timestamptz, ${SHIPS}),
                 ('1', ${fleet.fleetId}, now(), 30000), ('2', ${other.fleetId}, NULL::timestamptz, 30000)) seed(prefix, tenant, ended, size)
    CROSS JOIN LATERAL generate_series(1, size) i`;
  // Each declarer owns a label with forty legitimate values and twenty pairs.
  await core.prisma.$executeRaw`
    INSERT INTO labels (id, fleet_id, key, owner_ship_id)
    SELECT 'lbl_0' || lpad(i::text, 25, '0'), ${fleet.fleetId}, 'density-' || i, 'shp_0' || lpad(i::text, 25, '0') FROM generate_series(1, ${SHIPS}) i`;
  await core.prisma.$executeRaw`
    INSERT INTO label_values (id, fleet_id, label_id, value, position)
    SELECT 'lbv_0' || lpad(((i - 1) * 40 + j)::text, 25, '0'), ${fleet.fleetId}, 'lbl_0' || lpad(i::text, 25, '0'), 'value-' || j, j
    FROM generate_series(1, ${SHIPS}) i CROSS JOIN generate_series(1, 40) j`;
  await core.prisma.$executeRaw`
    INSERT INTO ship_labels (fleet_id, ship_id, label_id, value_id)
    SELECT ${fleet.fleetId}, 'shp_0' || lpad(i::text, 25, '0'), 'lbl_0' || lpad(i::text, 25, '0'), 'lbv_0' || lpad(((i - 1) * 40 + j)::text, 25, '0')
    FROM generate_series(1, ${SHIPS}) i CROSS JOIN generate_series(1, 2) j`;
  await core.prisma.$executeRaw`
    INSERT INTO events (id, fleet_id, type, occurred_at, actor_kind, actor_ship_id, details, seq)
    SELECT 'evt_0' || lpad(i::text, 25, '0'), ${fleet.fleetId}, CASE WHEN i % 10 = 0 THEN 'MessageAccepted' ELSE 'ReportUpdated' END,
           now(), 'ship', 'shp_0' || lpad(((i - 1) % ${SHIPS} + 1)::text, 25, '0'), '{}', i + 1000000 FROM generate_series(1, 100000) i`;
  const send = await fleet.label('sendable');
  await core.prisma.$executeRaw`
    INSERT INTO ship_labels (fleet_id, ship_id, label_id, value_id)
    SELECT ${fleet.fleetId}, s.id, value.label_id, value.id FROM ships s JOIN label_values value ON value.fleet_id = s.fleet_id AND value.id = ${send}
    WHERE s.fleet_id = ${fleet.fleetId} AND s.id LIKE 'shp_0%' AND s.name <= 'common-01500' AND s.retired_at IS NULL`;
  await fleet.setRules([{ verb: 'send', from: [], to: [send] }]);
  await core.prisma.$executeRaw`ANALYZE`;
  measured = createPrismaClientTellingStatements(core.databaseUrl, (statement) => { statements.push(statement); });
  reads = personReadsOf(createPrismaPersonReadUnitOfWork({ prisma: measured, portsOf: (connection): PersonShipReadTx => {
    const tx = createPrismaPersonShipReadTx({ connection, onStatement: (statement) => { statements.push(statement); } });
    return { facts: tx.facts, projection: {
      page: (fleetId, read) => { projections.push(personShipPageStatement(fleetId, read)); return tx.projection.page(fleetId, read); },
      reports: (fleetId, read) => { reportIds = read.shipIds; projections.push(personShipReportsStatement(fleetId, read)); return tx.projection.reports(fleetId, read); },
    } };
  } }));
}, 120000);

afterAll(async () => { await measured.$disconnect(); await core.close(); });

function nodes(plan: unknown): Map<string, unknown>[] {
  if (Array.isArray(plan)) { return plan.flatMap(nodes); }
  if (typeof plan !== 'object' || plan === null) { return []; }
  const own = new Map<string, unknown>(Object.entries(plan));
  return [own, ...[...own.values()].flatMap(nodes)];
}

function percentile(samples: number[], fraction: number): number {
  return [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * fraction) - 1] ?? 0;
}

async function density(isDense: boolean): Promise<void> {
  await core.prisma.$executeRaw`DELETE FROM declared_network_rules WHERE fleet_id = ${fleet.fleetId}`;
  await core.prisma.$executeRaw`
    INSERT INTO declared_network_rules (fleet_id, ship_id, rules)
    SELECT ${fleet.fleetId}, 'shp_0' || lpad(i::text, 25, '0'), jsonb_agg(jsonb_build_object('verb', 'read', 'from', '[]'::jsonb,
      'to', jsonb_build_array('lbv_0' || lpad(((i - 1) * 40 + j * 2 - 1)::text, 25, '0'), 'lbv_0' || lpad(((i - 1) * 40 + j * 2)::text, 25, '0'))))
    FROM generate_series(1, ${SHIPS}) i CROSS JOIN generate_series(1, 20) j
    WHERE ${isDense} OR i % 100 = 0 GROUP BY i`;
  await core.prisma.$executeRaw`ANALYZE declared_network_rules`;
}

function pageInput(section: 'discovery' | 'readableContext', shape: { search: string; isDeep: boolean }): PersonShipPageInput {
  const { search, isDeep } = shape;
  if (!isDeep) { return { search }; }
  return { search, cursor: personShipCursorOf({ version: 1, fleetId: fleet.fleetId, section, actor: section === 'discovery' ? { kind: 'ship', id: fleet.person.shipId } : { kind: 'account', id: fleet.account().accountId }, associatedShipId: fleet.person.shipId, search, order: 'folded-name-id-v1', after: { name: 'common-02800', shipId: seededId(2800) } }) };
}

describe('bounded person reads with 3000 seeded active ships, retained history and other fleets', () => {
  it.each([false, true])('records complete core operations and proves indexed bounds with dense rules=%s', async (isDense) => {
    // Given sparse or 60,000 valid distinct declared conjunctions, never a reach-id list.
    await density(isDense);
    const ids = Array.from({ length: 20 }, (_, index) => seededId(2801 + index));
    const shapes = [
      { name: 'blank', search: '', isDeep: false }, { name: 'one-character', search: 'm', isDeep: false },
      { name: 'two-character', search: 'om', isDeep: false }, { name: 'selective-trigram', search: 'Needle', isDeep: false },
      { name: 'common-trigram', search: 'Common', isDeep: false }, { name: 'deep', search: '', isDeep: true },
      { name: 'refresh', search: '', isDeep: false },
    ];
    for (const section of ['discovery', 'readableContext'] as const) {
      for (const shape of shapes) {
        const input = shape.name === 'refresh' ? { shipIds: ids } : pageInput(section, shape);
        const operation = () => section === 'discovery' ? reads.discoveryPage(fleet.person.crew, input) : reads.readableContextShips(fleet.account(), input);
        await prove({ name: `${section}/${shape.name}`, isDense }, async () => { const page = unwrap(await operation()); expect(page.rows.length).toBeLessThanOrEqual(20); });
      }
    }
    await prove({ name: 'shipReports/20', isDense }, async () => { expect(unwrap(await reads.shipReports(fleet.account(), { shipIds: ids })).rows.map((row) => row.shipId)).toEqual(ids); });
  }, 300000);
});

async function prove(shape: { name: string; isDense: boolean }, operation: () => Promise<void>): Promise<void> {
  const { name, isDense } = shape;
  const times: number[] = [];
  const counts: number[] = [];
  // First sample includes an initially unprepared operation; no permission cache exists.
  for (let sample = 0; sample <= SAMPLES; sample += 1) {
    statements = []; projections = []; reportIds = [];
    const start = performance.now();
    await operation();
    times.push(performance.now() - start);
    counts.push(statements.length);
    expect(reportIds.length).toBeLessThanOrEqual(20);
    expect(projections.length).toBeLessThanOrEqual(name.startsWith('readableContext') ? 2 : 1);
    expect(statements.some((statement) => /FROM\s+messages\b/i.test(statement))).toBe(false);
    expect(statements.length).toBeLessThanOrEqual(14);
  }
  // When each actual projection shape is explained, including permission parameters.
  const plans: unknown[] = [];
  for (const statement of projections) {
    const [row] = await core.prisma.$queryRaw<{ 'QUERY PLAN': unknown }[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`);
    const plan = row?.['QUERY PLAN'];
    plans.push(plan);
    // Then history is reached only by indexed fleet/ship probes, never a full scan.
    for (const node of nodes(plan)) {
      if (['ships', 'leases', 'events', 'alerts', 'ship_labels'].includes(String(node.get('Relation Name')))) {
        expect(node.get('Node Type'), `${name}: ${JSON.stringify(Object.fromEntries(node))}`).not.toBe('Seq Scan');
      }
      if (node.get('Relation Name') === 'events') {
        expect(node.get('Index Name')).toBe('events_person_activity_idx');
        expect(Number(node.get('Actual Loops'))).toBeLessThanOrEqual(20);
      }
      expect(node.get('Relation Name')).not.toBe('messages');
    }
  }
  console.info(JSON.stringify({ proof: 'bounded-core-only', name, isDense, seededActive: SHIPS, rules: isDense ? 60000 : 600, samples: SAMPLES, firstMs: times[0], p95Ms: percentile(times.slice(1), .95), p99Ms: percentile(times.slice(1), .99), errors: 0, queries: [...new Set(counts)], plans }));
}
