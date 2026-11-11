import { idSchema, type PersonShipPageInput, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClientTellingStatements, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaDeclaredNetworkRulesRepository, createPrismaNetworkSettingsRepository } from '../src/adapters/prisma/network.js';
import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { createPrismaPersonReadUnitOfWork } from '../src/adapters/prisma/person-read-unit-of-work.js';
import { createPrismaPersonShipReadTx } from '../src/adapters/prisma/person-ship-reads.js';
import { allowsReach, type ReachingShip } from '../src/domain/registry/network-settings.js';
import type { PersonShipReadTx } from '../src/domain/registry/person-ship-reads.js';
import { aPersonReadFleet, personReadsOf } from './support/person-read-postgres.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { hostConditions, percentile, recordEvidence, seededShipId, seedPopulation, SEEDED_SHIPS, storeWorkload, WORKLOADS, type Workload } from './support/rule-match-proof.js';

// Proof step 3 of rule-matches.md, bounded core calls only. Run with
// RULE_MATCH_PROOF=1 and RULE_MATCH_PROOF_OUT=<jsonl path>; budgets are
// p95 < 100 ms, p99 < 500 ms, errors < 1% per shape. 30 warm samples give a
// weak p99: the 30th of 30 order statistics, not a statistical estimate.

const WARM_SAMPLES = 30;
const P95_BUDGET_MS = 100;
const P99_BUDGET_MS = 500;
const MAX_MATCH_ROWS = 22;

let core: PostgresCore;
let fleet: Awaited<ReturnType<typeof aPersonReadFleet>>;
let measured: PrismaClient;
let statements: string[] = [];
let readStatements: Prisma.Sql[] = [];
let phases: Record<string, number> = {};
let reads: ReturnType<typeof personReadsOf>;

function newPool(): void {
  measured = createPrismaClientTellingStatements(core.databaseUrl, (statement) => { statements.push(statement); });
  reads = personReadsOf(createPrismaPersonReadUnitOfWork({ prisma: measured, portsOf: (connection): PersonShipReadTx => {
    const tx = createPrismaPersonShipReadTx({ connection, onQuery: (statement) => { readStatements.push(statement); }, onStatement: (statement) => { statements.push(statement); } });
    const timed = async <T>(phase: string, work: () => Promise<T>): Promise<T> => {
      const startedAt = performance.now();
      try {
        return await work();
      } finally {
        phases[phase] = (phases[phase] ?? 0) + performance.now() - startedAt;
      }
    };
    return {
      facts: { find: (caller, read) => timed('facts', () => tx.facts.find(caller, read)) },
      projection: {
        page: (fleetId, read) => timed('page', () => tx.projection.page(fleetId, read)),
        selectedReports: (fleetId, selected) => timed('reports', () => tx.projection.selectedReports(fleetId, selected)),
        reports: (fleetId, read) => timed('reports', () => tx.projection.reports(fleetId, read)),
      },
    };
  } }));
}

beforeAll(async () => {
  if (process.env.RULE_MATCH_PROOF !== '1') {
    return;
  }
  core = await createPostgresCore();
  fleet = await aPersonReadFleet(core);
  const other = await aPersonReadFleet(core);
  const seedStartedAt = performance.now();
  await seedPopulation(core, { fleetId: fleet.fleetId, otherFleetId: other.fleetId });
  const [version] = await core.prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
  recordEvidence({ kind: 'population', seedMs: performance.now() - seedStartedAt, seededActive: SEEDED_SHIPS, retiredBallast: 30000, otherFleetActive: 30000, otherFleetMatchRows: 60000, events: 100000, alerts: 30000, postgres: version?.version, host: hostConditions(), head: process.env.RULE_MATCH_PROOF_HEAD });
  newPool();
}, 600_000);

afterAll(async () => {
  if (process.env.RULE_MATCH_PROOF === '1') {
    await measured.$disconnect();
    await core.close();
  }
});

const carriedSchema = z.object({ shipId: idSchema('ship'), labelId: idSchema('label'), valueId: idSchema('labelValue') });
const shipSchema = z.object({ id: idSchema('ship'), name: z.string(), kind: z.enum(['operator', 'viewer', 'plugin', 'person', 'agent', 'app']), owner: idSchema('ship').nullable(), isOwnedByPerson: z.boolean() });

/** The network rules' own answer from the authoritative tables, for the subject and the account over every active ship. */
async function oracle(): Promise<{ sendable: Set<ShipId>; readable: Set<ShipId>; byName: ShipId[] }> {
  const settings = await createPrismaNetworkSettingsRepository(core.prisma).find(fleet.fleetId);
  const declared = await createPrismaDeclaredNetworkRulesRepository(core.prisma).list(fleet.fleetId);
  const inForce = { isOpen: settings.rules === null, isViewerReadOn: settings.isViewerReadOn, rules: settings.rules ?? [], declared };
  const carried = z.array(carriedSchema).parse(await core.prisma.$queryRaw`SELECT ship_id AS "shipId", label_id AS "labelId", value_id AS "valueId" FROM ship_labels WHERE fleet_id = ${fleet.fleetId}`);
  const ships = z.array(shipSchema).parse(await core.prisma.$queryRaw`
    SELECT s.id, s.name, s.kind::text AS kind, s.owner_ship_id AS owner, COALESCE(o.kind = 'person', false) AS "isOwnedByPerson"
    FROM ships s LEFT JOIN ships o ON o.fleet_id = s.fleet_id AND o.id = s.owner_ship_id
    WHERE s.fleet_id = ${fleet.fleetId} AND s.retired_at IS NULL AND s.removed_at IS NULL
    ORDER BY lower(s.name) COLLATE "C", s.id COLLATE "C"`);
  const labelsBy = new Map<ShipId, { labelId: typeof carried[number]['labelId']; valueId: typeof carried[number]['valueId'] }[]>();
  for (const { shipId, labelId, valueId } of carried) {
    labelsBy.set(shipId, [...(labelsBy.get(shipId) ?? []), { labelId, valueId }]);
  }
  const reaching = (ship: z.infer<typeof shipSchema>): ReachingShip => ({ id: ship.id, kind: ship.kind, owner: ship.owner, isOwnedByPerson: ship.isOwnedByPerson, labels: labelsBy.get(ship.id) ?? [] });
  const person = ships.find(({ id }) => id === fleet.person.shipId);
  if (person === undefined) {
    throw new Error('The subject must be active');
  }
  const sender = reaching(person);
  const account = { kind: 'account' as const, personShipId: person.id, labels: [] };
  const sendable = new Set(ships.filter((ship) => ship.id !== person.id && ship.kind !== 'viewer'
    && allowsReach(inForce, { verb: 'send', sender, recipient: reaching(ship), isAnswerToSender: false })).map(({ id }) => id));
  const readable = new Set(ships.filter((ship) => allowsReach(inForce, { verb: 'read', sender: account, recipient: reaching(ship), isAnswerToSender: false })).map(({ id }) => id));
  return { sendable, readable, byName: ships.map(({ id }) => id) };
}

type PlanNode = Map<string, unknown>;
function nodes(plan: unknown): PlanNode[] {
  if (Array.isArray(plan)) {
    return plan.flatMap(nodes);
  }
  if (typeof plan !== 'object' || plan === null) {
    return [];
  }
  const own = new Map<string, unknown>(Object.entries(plan));
  return [own, ...[...own.values()].flatMap(nodes)];
}

interface Shape {
  name: string;
  run: () => Promise<readonly ShipId[]>;
  expected: (truth: Awaited<ReturnType<typeof oracle>>) => readonly ShipId[];
}

const reportIds = Array.from({ length: 20 }, (_, index) => seededShipId(2801 + index));

function shapes(): Shape[] {
  const page = (input: PersonShipPageInput) => ({
    discovery: async () => { const result = await reads.discoveryPage(fleet.person.crew, input); if (!result.isOk) { throw new Error(result.error.kind); } return result.value.rows.map(({ shipId }) => shipId); },
    context: async () => { const result = await reads.readableContextShips(fleet.account(), input); if (!result.isOk) { throw new Error(result.error.kind); } return result.value.rows.map(({ shipId }) => shipId); },
  });
  const shapesOf = (search: string, label: string): Shape[] => [
    { name: `discovery/${label}`, run: page({ search }).discovery, expected: (truth) => truth.byName.filter((id) => truth.sendable.has(id) && (search === '' || searchedCache.get(search)?.has(id) === true)).slice(0, 20) },
    { name: `context/${label}`, run: page({ search }).context, expected: (truth) => truth.byName.filter((id) => truth.readable.has(id) && !truth.sendable.has(id) && (search === '' || searchedCache.get(search)?.has(id) === true)).slice(0, 20) },
  ];
  return [
    ...shapesOf('', 'blank'),
    ...shapesOf('m', 'one-character'),
    ...shapesOf('common', 'common-trigram'),
    {
      name: 'shipReports/20',
      run: async () => { const result = await reads.shipReports(fleet.account(), { shipIds: reportIds }); if (!result.isOk) { throw new Error(result.error.kind); } return result.value.rows.filter(({ report }) => report.status === 'read').map(({ shipId }) => shipId); },
      expected: (truth) => reportIds.filter((id) => truth.readable.has(id)),
    },
  ];
}

const searchedCache = new Map<string, Set<ShipId>>();

async function measureShape(measuredShape: { workload: Workload; shape: Shape; truth: Awaited<ReturnType<typeof oracle>> }): Promise<void> {
  const { workload, shape, truth } = measuredShape;
  await measured.$disconnect();
  newPool();
  const samples: { totalMs: number; phases: Record<string, number>; statements: number; isError: boolean; error?: string }[] = [];
  let lastStatements: Prisma.Sql[] = [];
  for (let sample = 0; sample <= WARM_SAMPLES; sample += 1) {
    statements = [];
    readStatements = [];
    phases = {};
    const startedAt = performance.now();
    try {
      const rows = await shape.run();
      const totalMs = performance.now() - startedAt;
      samples.push({ totalMs, phases: { ...phases, connectionLockSnapshotCleanup: totalMs - Object.values(phases).reduce((sum, value) => sum + value, 0) }, statements: statements.length, isError: false });
      // Then each call answers exactly what the network rules answer.
      expect.soft([...rows], `${workload.name} ${shape.name}`).toEqual([...shape.expected(truth)]);
    } catch (error) {
      samples.push({ totalMs: performance.now() - startedAt, phases: { ...phases }, statements: statements.length, isError: true, error: String(error) });
    }
    lastStatements = readStatements;
  }
  const warm = samples.slice(1).map(({ totalMs }) => totalMs);
  const errors = samples.filter(({ isError }) => isError).length;
  const plans: Record<string, unknown>[] = [];
  const seqScans: string[] = [];
  const bounds = { maxMatchRowsPerLoop: 0, matchLoops: 0, labelProbeLoops: 0, candidateLoops: 0, declarationNodes: 0, seqScans };
  for (const statement of lastStatements) {
    const [row] = await core.prisma.$queryRaw<{ 'QUERY PLAN': unknown }[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`);
    const all = nodes(row?.['QUERY PLAN']);
    plans.push({ statement: statement.text.slice(0, 160), nodes: all.map((node) => Object.fromEntries([...node].filter(([, value]) => typeof value !== 'object'))) });
    const isProjection = !statement.text.includes('network_settings') && !statement.text.includes('declared_network_rules') && !statement.text.includes('FROM ships s LEFT JOIN ships owner') && !statement.text.includes('label.key');
    for (const node of all) {
      const relation = String(node.get('Relation Name'));
      const loops = Number(node.get('Actual Loops') ?? 0);
      if (relation === 'ship_rule_matches') {
        bounds.maxMatchRowsPerLoop = Math.max(bounds.maxMatchRowsPerLoop, Number(node.get('Actual Rows') ?? 0));
        bounds.matchLoops += loops;
      }
      if (isProjection && relation === 'ship_labels') {
        bounds.labelProbeLoops += loops;
      }
      if (isProjection && relation === 'ships' && node.get('Index Name') !== undefined) {
        bounds.candidateLoops = Math.max(bounds.candidateLoops, Number(node.get('Actual Rows') ?? 0) * loops);
      }
      if (isProjection && relation === 'declared_network_rules') {
        bounds.declarationNodes += 1;
      }
      if (node.get('Node Type') === 'Seq Scan' && ['ships', 'leases', 'events', 'alerts', 'ship_labels', 'declared_network_rules', 'ship_rule_matches'].includes(relation)) {
        bounds.seqScans.push(relation);
      }
    }
  }
  const p95 = percentile(warm, 0.95);
  const p99 = percentile(warm, 0.99);
  const phaseP95 = Object.fromEntries([...new Set(samples.slice(1).flatMap((sample) => Object.keys(sample.phases)))].map((phase) => [phase, percentile(samples.slice(1).map((sample) => sample.phases[phase] ?? 0), 0.95)]));
  recordEvidence({ kind: 'read', workload: workload.name, shape: shape.name, newPoolMs: samples[0]?.totalMs, warmP95Ms: p95, warmP99OrderStatisticMs: p99, errors, calls: samples.length, statements: [...new Set(samples.map((sample) => sample.statements))], phaseP95, bounds, rawSamples: samples, plans });
  console.info(JSON.stringify({ workload: workload.name, shape: shape.name, newPoolMs: samples[0]?.totalMs, p95, p99, errors, statements: [...new Set(samples.map((sample) => sample.statements))], phaseP95, bounds }));
  // Then the plan reads at most 22 match rows per candidate, no declaration per candidate, and no seq scan.
  expect.soft(bounds.maxMatchRowsPerLoop, `${workload.name} ${shape.name} match rows`).toBeLessThanOrEqual(MAX_MATCH_ROWS);
  expect.soft(bounds.declarationNodes, `${workload.name} ${shape.name} declarations per candidate`).toBe(0);
  expect.soft(bounds.seqScans, `${workload.name} ${shape.name} seq scans`).toEqual([]);
  expect.soft(errors / samples.length, `${workload.name} ${shape.name} errors`).toBeLessThan(0.01);
  expect.soft(p95, `${workload.name} ${shape.name} p95`).toBeLessThan(P95_BUDGET_MS);
  expect.soft(p99, `${workload.name} ${shape.name} p99`).toBeLessThan(P99_BUDGET_MS);
}

describe.runIf(process.env.RULE_MATCH_PROOF === '1')('person ship reads by rule matches at the legal policy maximum, 3000 active ships', () => {
  it.each(WORKLOADS.map((workload) => [workload.name, workload] as const))('answer as the network rules do within budget: %s', async (_name, workload) => {
    // Given the workload stored as authoritative rows and its matches built by the domain.
    const built = await storeWorkload(core, { fleetId: fleet.fleetId, subjectId: fleet.person.shipId, workload });
    const truth = await oracle();
    for (const search of ['m', 'common']) {
      const rows = z.array(z.object({ id: idSchema('ship') })).parse(await core.prisma.$queryRaw`
        SELECT s.id FROM ships s LEFT JOIN leases l ON l.fleet_id = s.fleet_id AND l.ship_id = s.id AND l.ended_at IS NULL
        WHERE s.fleet_id = ${fleet.fleetId} AND s.retired_at IS NULL AND s.removed_at IS NULL
          AND (strpos(lower(s.name), ${search}) > 0 OR strpos(lower(crew_description(l.statement)), ${search}) > 0)`);
      searchedCache.set(search, new Set(rows.map(({ id }) => id)));
    }
    recordEvidence({ kind: 'workload', workload: workload.name, buildMs: built.buildMs, matchRows: built.matchRows, sendable: truth.sendable.size, readable: truth.readable.size, contextAuthorized: [...truth.readable].filter((id) => !truth.sendable.has(id)).length, host: hostConditions() });
    console.info(JSON.stringify({ workload: workload.name, ...built, sendable: truth.sendable.size, readable: truth.readable.size }));

    // When each shape runs as complete core calls, then it answers and stays bounded.
    for (const shape of shapes()) {
      await measureShape({ workload, shape, truth });
    }
  }, 900_000);
});
