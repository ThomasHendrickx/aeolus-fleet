/**
 * Bounded core proof for rule matches (#1741, rule-matches.md proof steps 3
 * to 5): a fleet of 3,000 seeded active ships with retired, other-fleet,
 * ended-lease, event and alert ballast, workloads at the legal policy
 * maximum seeded as authoritative rows, matches built by the domain, and
 * measured complete core calls. Bounded local results only: never the
 * integrated app/gateway/core proof at 3,000 ships and 10,000,000 messages.
 */
import { appendFileSync } from 'node:fs';
import { cpus, loadavg, totalmem } from 'node:os';

import { idSchema, type FleetId, type LabelId, type LabelValueId, type NetworkRule, type ShipId } from '@aeolus-fleet/common';

import { Prisma } from '../../src/adapters/prisma/generated/client.js';
import { createPrismaTx } from '../../src/adapters/prisma/unit-of-work.js';
import { keepEveryRuleMatch } from '../../src/domain/registry/keep-rule-matches.js';
import type { PostgresCore } from './postgres-core.js';

export const SEEDED_SHIPS = 3000;
export const DEFINERS = 20;
export const LABELS_PER_DEFINER = 20;
export const FLEET_LABELS = 20;

const pad = (prefix: string, number: number) => `${prefix}${String(number).padStart(25, '0')}`;
export const seededShipId = (number: number): ShipId => idSchema('ship').parse(pad('shp_0', number));
/** Definer d's label k: owned by seeded ship d. */
export const definerLabelId = (definer: number, label: number): LabelId => idSchema('label').parse(pad('lbl_9', definer * 100 + label));
/** Its first value (the subject's in the pair workloads) or its second. */
export const definerValueId = (definer: number, label: { label: number; value: 1 | 2 }): LabelValueId => idSchema('labelValue').parse(pad('lbv_9', (definer * 100 + label.label) * 10 + label.value));
/** The installation's label k, for the fleet's own rules. */
export const fleetLabelId = (label: number): LabelId => idSchema('label').parse(pad('lbl_8', label));
export const fleetValueId = (label: number, value: 1 | 2): LabelValueId => idSchema('labelValue').parse(pad('lbv_8', label * 10 + value));

export function hostConditions(): Record<string, unknown> {
  return { cpus: cpus().length, cpuModel: cpus()[0]?.model, memoryGiB: Math.round(totalmem() / 2 ** 30), loadAverage: loadavg(), node: process.version, note: 'shared local host, Testcontainers Postgres 16 via podman' };
}

/** Appends one JSON line of evidence, so raw samples survive a failing assertion. */
export function recordEvidence(line: Record<string, unknown>): void {
  const out = process.env.RULE_MATCH_PROOF_OUT;
  if (out !== undefined && out.length > 0) {
    appendFileSync(out, `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`);
  }
}

/** Seeds the population and ballast once: ships, leases, labels, events, alerts, an other fleet with its own matches. */
export async function seedPopulation(core: PostgresCore, fleets: { fleetId: FleetId; otherFleetId: FleetId }): Promise<void> {
  const { fleetId, otherFleetId } = fleets;
  await core.prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes, retired_at, owner_ship_id)
    SELECT 'shp_' || prefix || lpad(i::text, 25, '0'), tenant, 'common-' || lpad(i::text, 5, '0'), 'builder', now(), 'agent', '{messages:send}', ended, NULL
    FROM (VALUES ('0', ${fleetId}, NULL::timestamptz, ${SEEDED_SHIPS}),
                 ('1', ${fleetId}, now(), 30000), ('2', ${otherFleetId}, NULL::timestamptz, 30000)) seed(prefix, tenant, ended, size)
    CROSS JOIN LATERAL generate_series(1, size) i`;
  await core.prisma.$executeRaw`
    INSERT INTO leases (id, fleet_id, ship_id, location, started_at, ended_at, statement, report_state, report_note, activity_at)
    SELECT 'lse_' || prefix || lpad(i::text, 25, '0'), tenant, 'shp_' || prefix || lpad(i::text, 25, '0'), 'DEVICE', now(), ended,
           jsonb_build_object('summary', CASE WHEN i = 2800 THEN 'Needle description. Hidden.' ELSE 'Common first sentence. Hidden.' END, 'capabilities', '[]'::jsonb),
           'working', 'bounded note', now()
    FROM (VALUES ('0', ${fleetId}, NULL::timestamptz, ${SEEDED_SHIPS}),
                 ('1', ${fleetId}, now(), 30000), ('2', ${otherFleetId}, NULL::timestamptz, 30000)) seed(prefix, tenant, ended, size)
    CROSS JOIN LATERAL generate_series(1, size) i`;
  await core.prisma.$executeRaw`
    INSERT INTO labels (id, fleet_id, key, owner_kind, owner_ship_id)
    SELECT 'lbl_9' || lpad((d * 100 + k)::text, 25, '0'), ${fleetId}, 'definer-' || d || '-' || k, 'ship', 'shp_0' || lpad(d::text, 25, '0')
    FROM generate_series(1, ${DEFINERS}) d CROSS JOIN generate_series(1, ${LABELS_PER_DEFINER}) k
    UNION ALL
    SELECT 'lbl_8' || lpad(k::text, 25, '0'), ${fleetId}, 'fleet-' || k, 'installation', NULL FROM generate_series(1, ${FLEET_LABELS}) k`;
  await core.prisma.$executeRaw`
    INSERT INTO label_values (id, fleet_id, label_id, value, position)
    SELECT 'lbv_9' || lpad(((d * 100 + k) * 10 + v)::text, 25, '0'), ${fleetId}, 'lbl_9' || lpad((d * 100 + k)::text, 25, '0'), 'v' || v, v
    FROM generate_series(1, ${DEFINERS}) d CROSS JOIN generate_series(1, ${LABELS_PER_DEFINER}) k CROSS JOIN generate_series(1, 2) v
    UNION ALL
    SELECT 'lbv_8' || lpad((k * 10 + v)::text, 25, '0'), ${fleetId}, 'lbl_8' || lpad(k::text, 25, '0'), 'v' || v, v
    FROM generate_series(1, ${FLEET_LABELS}) k CROSS JOIN generate_series(1, 2) v`;
  await core.prisma.$executeRaw`
    INSERT INTO events (id, fleet_id, type, occurred_at, actor_kind, actor_ship_id, details, seq)
    SELECT 'evt_0' || lpad(i::text, 25, '0'), ${fleetId}, CASE WHEN i % 10 = 0 THEN 'MessageAccepted' ELSE 'ReportUpdated' END,
           now(), 'ship', 'shp_0' || lpad(((i - 1) % ${SEEDED_SHIPS} + 1)::text, 25, '0'), '{}', i + 1000000 FROM generate_series(1, 100000) i`;
  await core.prisma.$executeRaw`
    INSERT INTO alerts (id, fleet_id, ship_id, signal, occurrence_key, facts, since, raised_at, cleared_at)
    SELECT 'alt_0' || lpad(i::text, 25, '0'), ${fleetId}, 'shp_0' || lpad(((i - 1) % ${SEEDED_SHIPS} + 1)::text, 25, '0'),
           'report', 'occurrence-' || i, '{}', now(), now(), CASE WHEN i <= 300 THEN NULL ELSE now() END
    FROM generate_series(1, 30000) i`;
  // The other fleet's ships hold matches too, so the match table is not one fleet's.
  await core.prisma.$executeRaw`
    INSERT INTO ship_rule_matches (fleet_id, ship_id, verb, source, to_rules, to_rules_every_actor)
    SELECT ${otherFleetId}, 'shp_2' || lpad(i::text, 25, '0'), verb, 'fleet', repeat('1', 200)::varbit, repeat('1', 200)::varbit
    FROM generate_series(1, 30000) i CROSS JOIN (VALUES ('send'), ('read')) verb(verb)`;
}

/** What one workload stores: carried values per candidate, the subject's values, the declarations and the fleet's own rules. */
export interface Workload {
  name: string;
  candidateValues(candidate: number): readonly LabelValueId[];
  subjectValues: readonly LabelValueId[];
  declarations(definer: number): readonly NetworkRule[];
  ownRules: readonly NetworkRule[];
}

/** Replaces the fleet's carried values, declarations and own rules with the workload's, then builds its matches in one unit of work. */
export async function storeWorkload(core: PostgresCore, stored: { fleetId: FleetId; subjectId: ShipId; workload: Workload }): Promise<{ buildMs: number; matchRows: number }> {
  const { fleetId, subjectId, workload } = stored;
  await core.prisma.$executeRaw`DELETE FROM ship_labels WHERE fleet_id = ${fleetId}`;
  await core.prisma.$executeRaw`DELETE FROM declared_network_rules WHERE fleet_id = ${fleetId}`;
  const carried: { shipId: ShipId; valueId: LabelValueId }[] = [];
  for (let candidate = 1; candidate <= SEEDED_SHIPS; candidate += 1) {
    for (const valueId of workload.candidateValues(candidate)) {
      carried.push({ shipId: seededShipId(candidate), valueId });
    }
  }
  carried.push(...workload.subjectValues.map((valueId) => ({ shipId: subjectId, valueId })));
  await core.prisma.$executeRaw`
    INSERT INTO ship_labels (fleet_id, ship_id, label_id, value_id)
    SELECT ${fleetId}, carried.ship_id, value.label_id, value.id
    FROM unnest(${carried.map(({ shipId }) => shipId)}::text[], ${carried.map(({ valueId }) => valueId)}::text[]) carried(ship_id, value_id)
    JOIN label_values value ON value.fleet_id = ${fleetId} AND value.id = carried.value_id`;
  const declared = Array.from({ length: DEFINERS }, (_, index) => ({ shipId: seededShipId(index + 1), rules: workload.declarations(index + 1) })).filter(({ rules }) => rules.length > 0);
  if (declared.length > 0) {
    await core.prisma.$executeRaw`
      INSERT INTO declared_network_rules (fleet_id, ship_id, rules)
      SELECT ${fleetId}, declared.ship_id, declared.rules::jsonb
      FROM unnest(${declared.map(({ shipId }) => shipId)}::text[], ${declared.map(({ rules }) => JSON.stringify(rules))}::text[]) declared(ship_id, rules)`;
  }
  await core.prisma.$executeRaw`
    INSERT INTO network_settings (fleet_id, rules, built_in_viewer_read, version) VALUES (${fleetId}, ${JSON.stringify(workload.ownRules)}::jsonb, true, 1)
    ON CONFLICT (fleet_id) DO UPDATE SET rules = EXCLUDED.rules, version = network_settings.version + 1`;
  const startedAt = performance.now();
  await core.prisma.$transaction(async (db) => {
    await keepEveryRuleMatch(createPrismaTx(db), fleetId);
  }, { timeout: 300_000 });
  const buildMs = performance.now() - startedAt;
  await core.prisma.$executeRaw`ANALYZE`;
  const [counted] = await core.prisma.$queryRaw<{ rows: number }[]>(Prisma.sql`SELECT count(*)::int AS rows FROM ship_rule_matches WHERE fleet_id = ${fleetId}`);
  return { buildMs, matchRows: counted?.rows ?? 0 };
}

const range = (count: number) => Array.from({ length: count }, (_, index) => index + 1);
const labelOfCandidate = (candidate: number) => ((candidate - 1) % LABELS_PER_DEFINER) + 1;

/** One value of each definer: the second value of a label rotated by candidate. */
const rotatedDefinerValues = (candidate: number) => range(DEFINERS).map((definer) => definerValueId(definer, { label: labelOfCandidate(candidate), value: 2 }));

/**
 * The legal maximum the earlier structures failed (rule-matches.md proof step
 * 3, Q5), each sparse unless named broad: zero or fewer than 21 authorized
 * candidates, so no LIMIT stops the scan.
 */
export const WORKLOADS: readonly Workload[] = [
  {
    // The failed combined shape: 20 definers x 20 rules, empty from, 20-term to with one witness missing.
    name: 'combined-missing-witness',
    candidateValues: rotatedDefinerValues,
    subjectValues: [],
    declarations: (definer) => range(LABELS_PER_DEFINER).map((label): NetworkRule => ({
      verb: 'send', from: [], to: [definerValueId(definer, { label: label, value: 2 }), ...range(LABELS_PER_DEFINER).filter((other) => other !== label).map((other) => definerValueId(definer, { label: other, value: 1 }))],
    })),
    ownRules: [],
  },
  {
    // Late failure: every term but the last held by 19 of 20 rules' candidates is impossible within 20 values, so the
    // 19-of-20 shape uses the subject side: nonempty from the subject meets, to failing on its last term.
    name: 'combined-late-failure-from',
    candidateValues: rotatedDefinerValues,
    subjectValues: range(DEFINERS).map((definer) => definerValueId(definer, { label: 1, value: 1 })),
    declarations: (definer) => range(LABELS_PER_DEFINER).map((label): NetworkRule => ({
      verb: 'send', from: [definerValueId(definer, { label: 1, value: 1 })], to: [definerValueId(definer, { label: label, value: 2 }), definerValueId(definer, { label: label, value: 1 })],
    })),
    ownRules: [],
  },
  {
    // Pair keys unshared: subject carries v1 of each definer's first label, candidates v2 of it; 20 # rules per definer.
    name: 'pair-unshared',
    candidateValues: () => range(DEFINERS).map((definer) => definerValueId(definer, { label: 1, value: 2 })),
    subjectValues: range(DEFINERS).map((definer) => definerValueId(definer, { label: 1, value: 1 })),
    declarations: (definer) => range(LABELS_PER_DEFINER).map((label): NetworkRule => ({
      verb: 'send', from: [{ labelId: definerLabelId(definer, label), value: '#' }], to: [{ labelId: definerLabelId(definer, label), value: '#' }],
    })),
    ownRules: [],
  },
  {
    // Context with both predicates: the account reads every candidate, the person ship sends to every one through
    // shared pair keys, so the full sendable set excludes them all and the page stays empty.
    name: 'context-pair-shared-excluded',
    candidateValues: () => range(DEFINERS).map((definer) => definerValueId(definer, { label: 1, value: 1 })),
    subjectValues: range(DEFINERS).map((definer) => definerValueId(definer, { label: 1, value: 1 })),
    declarations: (definer) => range(LABELS_PER_DEFINER).map((label): NetworkRule => ({
      verb: label % 2 === 0 ? 'read' : 'send', from: [{ labelId: definerLabelId(definer, label), value: '#' }], to: [{ labelId: definerLabelId(definer, label), value: '#' }],
    })),
    ownRules: [{ verb: 'read', from: [], to: [{ labelId: definerLabelId(1, 1), value: '*' }] }],
  },
  {
    // Q5: the fleet's own 200 rules, empty from, 20-term to failing on its last term.
    name: 'own-200-late-failure',
    candidateValues: () => range(FLEET_LABELS).map((label) => fleetValueId(label, 1)),
    subjectValues: [],
    declarations: () => [],
    ownRules: range(200).map((rule): NetworkRule => {
      const missing = (rule % FLEET_LABELS) + 1;
      return { verb: 'send', from: [], to: [...range(FLEET_LABELS).filter((label) => label !== missing).map((label) => fleetValueId(label, 1)), fleetValueId(missing, 2)] };
    }),
  },
  {
    // The fleet's own 200 rules with pair keys on 20 labels, from met by the subject, to by every candidate, keys unshared.
    name: 'own-200-pair-unshared',
    candidateValues: () => range(FLEET_LABELS).map((label) => fleetValueId(label, 2)),
    subjectValues: range(FLEET_LABELS).map((label) => fleetValueId(label, 1)),
    declarations: () => [],
    ownRules: range(200).map((rule): NetworkRule => {
      const label = (rule % FLEET_LABELS) + 1;
      const other = ((rule + 7) % FLEET_LABELS) + 1;
      return { verb: rule % 4 === 0 ? 'read' : 'send', from: [{ labelId: fleetLabelId(label), value: '#' }, { labelId: fleetLabelId(other), value: '*' }], to: [{ labelId: fleetLabelId(label), value: '#' }] };
    }),
  },
];

export function percentile(samples: readonly number[], fraction: number): number {
  return [...samples].sort((one, other) => one - other)[Math.ceil(samples.length * fraction) - 1] ?? 0;
}
