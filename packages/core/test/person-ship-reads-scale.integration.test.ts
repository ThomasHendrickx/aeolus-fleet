import { idSchema, personShipCursorOf, type PersonShipPageInput, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClientTellingStatements, type PrismaClient } from '../src/adapters/prisma/client.js';
import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { createPrismaPersonReadUnitOfWork } from '../src/adapters/prisma/person-read-unit-of-work.js';
import { createPrismaPersonShipReadTx } from '../src/adapters/prisma/person-ship-reads.js';
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
let projectionCount = 0;
let readStatements: Prisma.Sql[] = [];
let reportIds: readonly ShipId[] = [];
let phases: Partial<Record<string, number>> = {};
let factsEndedAt = 0;
let projectionSentAt = 0;
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
  await core.prisma.$executeRaw`INSERT INTO declared_network_rules (fleet_id, ship_id, rules) SELECT ${other.fleetId}, id, '[]'::jsonb FROM ships WHERE fleet_id = ${other.fleetId} AND id LIKE 'shp_2%'`;
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
  await core.prisma.$executeRaw`
    INSERT INTO alerts (id, fleet_id, ship_id, signal, occurrence_key, facts, since, raised_at, cleared_at)
    SELECT 'alt_0' || lpad(i::text, 25, '0'), ${fleet.fleetId}, 'shp_0' || lpad(((i - 1) % ${SHIPS} + 1)::text, 25, '0'),
           'report', 'occurrence-' || i, '{}', now(), now(), CASE WHEN i <= 300 THEN NULL ELSE now() END
    FROM generate_series(1, 30000) i`;
  const send = await fleet.label('sendable');
  await core.prisma.$executeRaw`
    INSERT INTO ship_labels (fleet_id, ship_id, label_id, value_id)
    SELECT ${fleet.fleetId}, s.id, value.label_id, value.id FROM ships s JOIN label_values value ON value.fleet_id = s.fleet_id AND value.id = ${send}
    WHERE s.fleet_id = ${fleet.fleetId} AND s.id LIKE 'shp_0%' AND s.name <= 'common-01500' AND s.retired_at IS NULL`;
  await fleet.setRules([{ verb: 'send', from: [], to: [send] }]);
  await core.prisma.$executeRaw`ANALYZE`;
  resetMeasuredReads();
}, 120000);

function resetMeasuredReads(): void {
  measured = createPrismaClientTellingStatements(core.databaseUrl, (statement) => { statements.push(statement); });
  reads = personReadsOf(createPrismaPersonReadUnitOfWork({ prisma: measured, portsOf: (connection): PersonShipReadTx => {
    const tx = createPrismaPersonShipReadTx({ connection, onQuery: (statement) => { readStatements.push(statement); }, onStatement: (statement) => { statements.push(statement); projectionSentAt = performance.now(); } });
    return { facts: { find: async (caller, read) => { const start = performance.now(); const facts = await tx.facts.find(caller, read); factsEndedAt = performance.now(); phases.facts = factsEndedAt - start; return facts; } }, projection: {
      page: async (fleetId, read) => { const start = performance.now(); phases.compiler = start - factsEndedAt; projectionCount += 1; const page = await tx.projection.page(fleetId, read); phases.pageRender = projectionSentAt - start; phases.pageQuery = performance.now() - projectionSentAt; return page; },
      selectedReports: async (fleetId, selected) => { const start = performance.now(); reportIds = selected.map(({ row }) => row.shipId); projectionCount += 1; const reports = await tx.projection.selectedReports(fleetId, selected); phases.reportRender = projectionSentAt - start; phases.reportQuery = performance.now() - projectionSentAt; return reports; },
      reports: async (fleetId, read) => { const start = performance.now(); phases.compiler ??= start - factsEndedAt; reportIds = read.shipIds; projectionCount += 1; const reports = await tx.projection.reports(fleetId, read); phases.reportRender = projectionSentAt - start; phases.reportQuery = performance.now() - projectionSentAt; return reports; },
    } };
  } }));
}

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
      { name: 'common-trigram', search: 'Common', isDeep: false }, { name: 'selective-name', search: '02800', isDeep: false },
      { name: 'no-match', search: 'absent-needle', isDeep: false }, { name: 'deep', search: '', isDeep: true },
      { name: 'deep-search', search: 'common', isDeep: true },
      { name: 'refresh', search: '', isDeep: false },
    ];
    for (const section of ['discovery', 'readableContext'] as const) {
      for (const shape of shapes) {
        const input = shape.name === 'refresh' ? { shipIds: ids } : pageInput(section, shape);
        const operation = () => section === 'discovery' ? reads.discoveryPage(fleet.person.crew, input) : reads.readableContextShips(fleet.account(), input);
        await prove({ name: `${section}/${shape.name}`, isDense }, async () => { const page = unwrap(await operation()); expect(page.rows.length).toBeLessThanOrEqual(20); expect(reportIds).toEqual(section === 'readableContext' ? page.rows.map(({ shipId }) => shipId) : []); });
      }
    }
    await prove({ name: 'shipReports/20', isDense }, async () => { expect(unwrap(await reads.shipReports(fleet.account(), { shipIds: ids })).rows.map((row) => row.shipId)).toEqual(ids); });
  }, 300000);
});

async function prove(shape: { name: string; isDense: boolean }, operation: () => Promise<void>): Promise<void> {
  const { name, isDense } = shape;
  // Cold means a new client/pool; database pages and process code may be warm.
  // Every sample reloads rights and recompiles its plan without a permission cache.
  await measured.$disconnect();
  resetMeasuredReads();
  const times: number[] = [];
  const counts: number[] = [];
  const phaseSamples: Record<string, number[]> = {};
  // First sample includes new-pool connection/adapter overhead; the next 30 reuse that pool.
  for (let sample = 0; sample <= SAMPLES; sample += 1) {
    statements = []; projectionCount = 0; reportIds = []; phases = {}; readStatements = [];
    const start = performance.now();
    await operation();
    times.push(performance.now() - start);
    if (sample > 0) { for (const [phase, milliseconds] of Object.entries(phases)) { if (milliseconds !== undefined) { (phaseSamples[phase] ??= []).push(milliseconds); } } }
    counts.push(statements.length);
    expect(reportIds.length).toBeLessThanOrEqual(20);
    expect(projectionCount).toBeLessThanOrEqual(name.startsWith('readableContext') ? 2 : 1);
    expect(statements.some((statement) => /FROM\s+messages\b/i.test(statement))).toBe(false);
    expect(statements.length).toBeLessThanOrEqual(14);
  }
  // When each actual projection shape is explained, including permission parameters.
  const plans: unknown[] = [];
  for (const statement of readStatements) {
    const isProjection = statement.text.includes('AS "shipId"') && !statement.text.includes('jsonb_path_query_array');
    const [row] = await core.prisma.$queryRaw<{ 'QUERY PLAN': unknown }[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`);
    const plan = row?.['QUERY PLAN'];
    plans.push(nodes(plan).map((node) => Object.fromEntries([...node].filter(([, value]) => typeof value !== 'object').map(([key, value]) => [key, typeof value === 'string' && value.length > 512 ? `${value.slice(0, 512)} [${String(value.length)} characters]` : value]))));
    // Then history is reached only by indexed fleet/ship probes, never a full scan.
    for (const node of nodes(plan)) {
      if (['ships', 'leases', 'events', 'alerts', 'ship_labels', 'declared_network_rules'].includes(String(node.get('Relation Name')))) {
        expect.soft(node.get('Node Type'), `${name}: ${JSON.stringify(Object.fromEntries(node))}`).not.toBe('Seq Scan');
      }
      if (isProjection && name.endsWith('/refresh') && node.get('Relation Name') === 'ships') {
        expect.soft(Number(node.get('Actual Rows')) * Number(node.get('Actual Loops')), `${name}: only concerned ship probes`).toBeLessThanOrEqual(20);
      }
      if (['ships_person_name_search_idx', 'leases_crew_description_search_idx'].includes(String(node.get('Index Name')))) {
        expect.soft(name.endsWith('/refresh'), 'refresh uses primary keys instead of fleet search').toBe(false);
        expect.soft(Number(node.get('Actual Rows')), `${name}: trigram candidates stay fleet-bounded`).toBeLessThanOrEqual(SHIPS);
      }
      if (isProjection && node.get('Relation Name') === 'ship_labels' && Number(node.get('Actual Loops')) > 0) {
        expect.soft(String(node.get('Index Cond')), `${name}: labels stay correlated to one candidate`).toContain('ship_id = s.id');
        expect.soft(Number(node.get('Actual Rows'))).toBeLessThanOrEqual(3);
      }
      if (node.get('Relation Name') === 'alerts' && Number(node.get('Actual Loops')) > 0) {
        expect.soft(String(node.get('Index Cond')), `${name}: alerts stay limited to requested ships`).toContain('ship_id = s.id');
        expect.soft(Number(node.get('Actual Loops'))).toBeLessThanOrEqual(20);
        expect.soft(Number(node.get('Actual Rows'))).toBeLessThanOrEqual(1);
      }
      if (node.get('Relation Name') === 'events') {
        expect.soft(node.get('Index Name')).toBe('events_person_activity_idx');
        expect.soft(Number(node.get('Actual Loops'))).toBeLessThanOrEqual(20);
      }
      expect(node.get('Relation Name')).not.toBe('messages');
    }
  }
  console.info(JSON.stringify({ proof: 'bounded-core-only', name, isDense, seededActive: SHIPS, rules: isDense ? 60000 : 600, samples: SAMPLES, coldPoolMs: times[0], databaseCache: 'warm after seed/analyze', p95Ms: percentile(times.slice(1), .95), p99Ms: percentile(times.slice(1), .99), errors: 0, queries: [...new Set(counts)], phasesP95: Object.fromEntries(Object.entries(phaseSamples).map(([phase, values]) => [phase, percentile(values, .95)])), plans }));
}
