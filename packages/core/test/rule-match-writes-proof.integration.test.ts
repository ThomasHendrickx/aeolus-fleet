import { idSchema, type FleetId, type LabelValueId, type NetworkRule, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ShipCaller } from '../src/domain/shared/caller.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { aPersonReadFleet } from './support/person-read-postgres.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { hostConditions, percentile, recordEvidence, seededShipId, seedPopulation, SEEDED_SHIPS } from './support/rule-match-proof.js';
import { expectRuleMatchesKept } from './support/rule-match-postgres.js';

// Proof step 4 of rule-matches.md and the Q2 gate: writers at the legal
// maximum with 3,000 carriers, and sends that start while the writer holds
// the network settings lock, each at p95 < 100 ms and p99 < 500 ms. Bounded
// core calls only. Run with RULE_MATCH_PROOF=1 and RULE_MATCH_PROOF_OUT.
// 30 warm samples give a weak p99, the largest of 30, not an estimate.

const WARM_SAMPLES = 30;
const SENDS_PER_SAMPLE = 4;
const P95_BUDGET_MS = 100;
const P99_BUDGET_MS = 500;

let core: PostgresCore;
let fleet: Awaited<ReturnType<typeof aPersonReadFleet>>;
let declarer: ShipCaller;

beforeAll(async () => {
  if (process.env.RULE_MATCH_PROOF !== '1') {
    return;
  }
  core = await createPostgresCore();
  fleet = await aPersonReadFleet(core);
  const other = await aPersonReadFleet(core);
  await seedPopulation(core, { fleetId: fleet.fleetId, otherFleetId: other.fleetId });
  declarer = { kind: 'agent', shipId: seededShipId(1), fleetId: fleet.fleetId, scopes: ['labels:define', 'labels:assign'] };
  await core.prisma.$executeRaw`ANALYZE`;
  recordEvidence({ kind: 'writes-population', seededActive: SEEDED_SHIPS, host: hostConditions(), head: process.env.RULE_MATCH_PROOF_HEAD });
}, 600_000);

afterAll(async () => {
  if (process.env.RULE_MATCH_PROOF === '1') {
    await core.close();
  }
});

async function holdsSettingsExclusively(fleetId: FleetId): Promise<boolean> {
  const rows = await core.prisma.$queryRaw<{ isHeld: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted AND mode = 'ExclusiveLock'
      AND classid = hashtext(${fleetId})::oid AND objid = hashtext('network-settings')::oid) AS "isHeld"`;
  return rows[0]?.isHeld === true;
}

interface TimedSend { startedAfterLockMs: number; latencyMs: number; isOverlapping: boolean; isError: boolean }

/**
 * Runs the writer; once it holds the settings exclusively (or, for a shared
 * writer, once it started), starts sends to carriers, and records whether
 * each send started before the writer finished.
 */
async function withSendsDuring(writer: () => Promise<unknown>, options: { isExclusive: boolean }): Promise<{ writerMs: number; sends: TimedSend[]; wasLockSeen: boolean }> {
  const startedAt = performance.now();
  let writerEndedAt = Number.POSITIVE_INFINITY;
  const written = writer().then(() => { writerEndedAt = performance.now(); });
  let wasLockSeen = false;
  if (options.isExclusive) {
    while (!wasLockSeen && writerEndedAt === Number.POSITIVE_INFINITY) {
      wasLockSeen = await holdsSettingsExclusively(fleet.fleetId);
    }
  }
  const lockSeenAt = performance.now();
  const sends = Array.from({ length: SENDS_PER_SAMPLE }, async (_, index): Promise<TimedSend> => {
    const sentAt = performance.now();
    const sent = await core.useCases.sendMessage(fleet.argo, { selector: { kind: 'ship', shipId: seededShipId(2000 + index) }, payload: 'during a writer', contentType: 'text/plain', idempotencyKey: newKey() });
    const endedAt = performance.now();
    return { startedAfterLockMs: sentAt - lockSeenAt, latencyMs: endedAt - sentAt, isOverlapping: sentAt < writerEndedAt, isError: !sent.isOk };
  });
  const timedSends = await Promise.all(sends);
  await written;
  return { writerMs: writerEndedAt - startedAt, sends: timedSends, wasLockSeen };
}

interface Writer {
  name: string;
  isExclusive: boolean;
  prepare: (sample: number) => Promise<() => Promise<unknown>>;
}

async function measureWriter(writer: Writer): Promise<void> {
  const samples: { writerMs: number; sends: TimedSend[]; wasLockSeen: boolean; isError: boolean; error?: string }[] = [];
  for (let sample = 0; sample <= WARM_SAMPLES; sample += 1) {
    const run = await writer.prepare(sample);
    try {
      samples.push({ ...(await withSendsDuring(run, { isExclusive: writer.isExclusive })), isError: false });
    } catch (error) {
      samples.push({ writerMs: Number.NaN, sends: [], wasLockSeen: false, isError: true, error: String(error) });
    }
  }
  const warm = samples.slice(1);
  const writerTimes = warm.filter(({ isError }) => !isError).map(({ writerMs }) => writerMs);
  const overlapping = warm.flatMap(({ sends }) => sends.filter(({ isOverlapping }) => isOverlapping));
  const sendTimes = overlapping.map(({ latencyMs }) => latencyMs);
  const errors = samples.filter(({ isError }) => isError).length + samples.flatMap(({ sends }) => sends).filter(({ isError }) => isError).length;
  const summary = {
    writer: writer.name, firstSampleMs: samples[0]?.writerMs, writerP95Ms: percentile(writerTimes, 0.95), writerP99OrderStatisticMs: percentile(writerTimes, 0.99),
    sendsOverlapping: overlapping.length, sendsTotal: warm.flatMap(({ sends }) => sends).length, sendP95Ms: percentile(sendTimes, 0.95), sendP99Ms: percentile(sendTimes, 0.99),
    samplesThatSawTheLock: warm.filter(({ wasLockSeen }) => wasLockSeen).length, errors,
  };
  recordEvidence({ kind: 'write', ...summary, rawSamples: samples, host: hostConditions() });
  console.info(JSON.stringify(summary));
  // Then the writer and the sends that overlapped it meet the budget, with no errors.
  expect.soft(errors, `${writer.name} errors`).toBe(0);
  if (writer.isExclusive) {
    expect.soft(overlapping.length, `${writer.name} sends overlapped the held lock`).toBeGreaterThan(WARM_SAMPLES);
  }
  expect.soft(summary.writerP95Ms, `${writer.name} writer p95`).toBeLessThan(P95_BUDGET_MS);
  expect.soft(summary.writerP99OrderStatisticMs, `${writer.name} writer p99`).toBeLessThan(P99_BUDGET_MS);
  expect.soft(summary.sendP95Ms, `${writer.name} send p95`).toBeLessThan(P95_BUDGET_MS);
  expect.soft(summary.sendP99Ms, `${writer.name} send p99`).toBeLessThan(P99_BUDGET_MS);
}

async function carriedByEveryShip(valueId: LabelValueId): Promise<void> {
  await core.prisma.$executeRaw`
    INSERT INTO ship_labels (fleet_id, ship_id, label_id, value_id)
    SELECT ${fleet.fleetId}, s.id, value.label_id, value.id FROM ships s JOIN label_values value ON value.fleet_id = s.fleet_id AND value.id = ${valueId}
    WHERE s.fleet_id = ${fleet.fleetId} AND s.id LIKE 'shp_0%' AND s.retired_at IS NULL
    ON CONFLICT DO NOTHING`;
}

const range = (count: number) => Array.from({ length: count }, (_, index) => index);

describe.runIf(process.env.RULE_MATCH_PROOF === '1')('rule-match writers at the legal maximum with 3000 carriers, and sends during them', () => {
  it('declare and replace 20 rules over 3000 carriers', async () => {
    // Given a declarer whose 20 values are carried, one each, by every one of 3000 ships.
    const label = unwrap(await core.useCases.defineLabel(declarer, { key: 'carried-by-all', values: range(20).map((value) => `v${String(value)}`) }));
    const values = label.values.map(({ id }) => id);
    for (const [index, valueId] of values.entries()) {
      await core.prisma.$executeRaw`
        INSERT INTO ship_labels (fleet_id, ship_id, label_id, value_id)
        SELECT ${fleet.fleetId}, 'shp_0' || lpad(i::text, 25, '0'), ${label.labelId}, ${valueId} FROM generate_series(1, ${SEEDED_SHIPS}) i WHERE i % 20 = ${index}`;
    }
    await fleet.setRules([]);
    const rulesOf = (sample: number): NetworkRule[] => values.map((valueId, index) => ({ verb: (index + sample) % 2 === 0 ? 'send' : 'read', from: [], to: [valueId] }));

    // When it replaces its declaration, sample after sample, sends running while it holds the settings.
    await measureWriter({ name: 'declare-replace-3000-carriers', isExclusive: true, prepare: (sample) => Promise.resolve(() => core.useCases.declareNetworkRules(declarer, { rules: rulesOf(sample) }).then(unwrap)) });

    // Then the matches are fresh.
    await expectRuleMatchesKept(core, fleet.fleetId);
  }, 900_000);

  it('apply 200 own rules over 3000 ships', async () => {
    // Given 200 own rules that hold for every ship carrying the declarer's values.
    const valueIds = valueIdsOf(await core.prisma.$queryRaw<{ id: string }[]>`SELECT v.id FROM label_values v JOIN labels l ON l.fleet_id = v.fleet_id AND l.id = v.label_id WHERE l.fleet_id = ${fleet.fleetId} AND l.key = 'carried-by-all' ORDER BY v.position`);
    const draftOf = (sample: number): NetworkRule[] => range(200).map((rule) => ({ verb: (rule + sample) % 2 === 0 ? 'send' : 'read', from: [], to: [valueIds[rule % 20] ?? valueIds[0] ?? idSchema('labelValue').parse('lbv_00000000000000000000000000')] }));

    // When the fleet applies another 200 rules, sample after sample, sends running while it holds the settings.
    await measureWriter({ name: 'apply-200-own-rules-3000-ships', isExclusive: true, prepare: async (sample) => {
      const saved = unwrap(await core.useCases.saveNetworkRulesDraft(fleet.argo, { rules: draftOf(sample) }));
      return () => core.useCases.applyNetworkRules(fleet.argo, { version: saved.savedAgainstVersion }).then(unwrap);
    } });

    // Then the matches are fresh.
    await expectRuleMatchesKept(core, fleet.fleetId);
  }, 900_000);

  it('retire a declarer whose label 3000 ships carry', async () => {
    // Given, each sample, a fresh declarer with a label every ship carries and 20 rules on it.
    await measureWriter({ name: 'retire-declarer-3000-carriers', isExclusive: true, prepare: async (sample) => {
      const { shipId } = unwrap(await core.useCases.commissionShip(fleet.argo, { idempotencyKey: newKey(), name: `retiring-${String(sample)}`, type: 'definer', scopes: ['labels:define'] }));
      const retiring: ShipCaller = { kind: 'agent', shipId, fleetId: fleet.fleetId, scopes: ['labels:define'] };
      const label = unwrap(await core.useCases.defineLabel(retiring, { key: `retiring-${String(sample)}`, values: ['all'] }));
      const valueId = label.values[0]?.id;
      if (valueId === undefined) {
        throw new Error('The label has its value');
      }
      await carriedByEveryShip(valueId);
      unwrap(await core.useCases.declareNetworkRules(retiring, { rules: range(20).map((rule) => ({ verb: rule % 2 === 0 ? 'send' : 'read', from: [], to: [valueId] })) }));

      // When it retires, sends running while the retire holds the settings.
      return () => core.useCases.retireShip(fleet.argo, { shipId }).then(unwrap);
    } });

    // Then the matches are fresh.
    await expectRuleMatchesKept(core, fleet.fleetId);
  }, 1_800_000);

  it('assign a label value on a ship carrying 20 values', async () => {
    // Given a ship carrying 19 values, about to get and lose a twentieth.
    const target: ShipId = seededShipId(1500);
    await core.prisma.$executeRaw`DELETE FROM ship_labels WHERE fleet_id = ${fleet.fleetId} AND ship_id = ${target}`;
    const label = unwrap(await core.useCases.defineLabel(fleet.argo, { key: 'twenty', values: range(20).map((value) => `t${String(value)}`) }));
    const values = label.values.map(({ id }) => id);
    for (const valueId of values.slice(0, 19)) {
      unwrap(await core.useCases.assignLabel(fleet.argo, { shipId: target, valueId }));
    }
    const twentieth = values[19] ?? values[0];
    if (twentieth === undefined) {
      throw new Error('The label has its values');
    }

    // When the twentieth is assigned, sample after sample, sends running alongside (a shared holder).
    await measureWriter({ name: 'assign-20th-value', isExclusive: false, prepare: async () => {
      await core.useCases.unassignLabel(fleet.argo, { shipId: target, valueId: twentieth });
      return () => core.useCases.assignLabel(fleet.argo, { shipId: target, valueId: twentieth }).then(unwrap);
    } });

    // Then the matches are fresh.
    await expectRuleMatchesKept(core, fleet.fleetId);
  }, 900_000);
});

function valueIdsOf(rows: readonly { id: string }[]): LabelValueId[] {
  return rows.map(({ id }) => idSchema('labelValue').parse(id));
}
