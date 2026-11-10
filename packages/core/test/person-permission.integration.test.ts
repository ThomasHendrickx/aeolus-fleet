import { idSchema, type NetworkRule, type ShipKind } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { personPermissionSql } from '../src/adapters/prisma/person-permission.js';
import { personPermissionPlan } from '../src/domain/registry/person-permission.js';
import { allowsReach, type ReachingActor, type ReachingShip, type RulesInForce } from '../src/domain/registry/network-settings.js';
import { createEmptyDatabase } from '../src/testing/database.js';

const shipId = (index: number) => idSchema('ship').parse(`shp_${String(index).padStart(26, '0')}`);
const labelId = idSchema('label').parse('lbl_00000000000000000000000001');
const red = idSchema('labelValue').parse('lbv_00000000000000000000000001');
const blue = idSchema('labelValue').parse('lbv_00000000000000000000000002');
const fleetId = idSchema('fleet').parse('flt_00000000000000000000000001');
const labels = [{ labelId, valueId: red }, { labelId, valueId: blue }];
const kinds: ShipKind[] = ['operator', 'plugin', 'viewer', 'agent', 'person', 'app'];
const candidates: ReachingShip[] = kinds.flatMap((kind, index) => [null, shipId(50), shipId(51)].map((owner, offset) => ({
  id: shipId(index * 3 + offset + 1), kind, owner, isOwnedByPerson: false, labels: offset === 0 ? [] : [labels[offset - 1]].filter((label) => label !== undefined),
})));
candidates.push({ id: shipId(70), kind: 'agent', owner: null, isOwnedByPerson: false, labels });
const subjects: ReachingActor[] = [
  ...candidates,
  { kind: 'account', personShipId: shipId(50), labels },
  { kind: 'account', personShipId: null, labels: [] },
  { kind: 'installation' },
];
const rules: NetworkRule[] = [
  { verb: 'send', from: [], to: [red] },
  { verb: 'read', from: [red], to: [{ labelId, value: '*' }] },
  { verb: 'send', from: [{ labelId, value: '#' }], to: [{ labelId, value: '#' }] },
  { verb: 'read', from: [{ owner: '#' }], to: [{ owner: '#' }] },
  { verb: 'read', from: [{ owner: '*' }], to: [{ owner: shipId(50) }] },
  { verb: 'send', from: [{ owner: shipId(50) }], to: [{ owner: '*' }, blue] },
  { verb: 'read', from: [{ labelId, value: '*' }], to: [blue] },
  { verb: 'read', from: [red, { labelId, value: '#' }], to: [{ labelId, value: '#' }, blue] },
  { verb: 'read', from: [{ labelId, value: '#' }, { owner: '#' }], to: [{ labelId, value: '#' }, { owner: '#' }] },
  { verb: 'read', from: [], to: [] },
];
let prisma: PrismaClient;
beforeAll(async () => { prisma = createPrismaClient(await createEmptyDatabase()); });
afterAll(async () => { await prisma.$disconnect(); });

async function reached(subject: ReachingActor, read: { inForce: RulesInForce; verb: 'read' | 'send' }) {
  const { inForce, verb } = read;
  const carried = candidates.flatMap((candidate) => candidate.labels.map((label) => Prisma.sql`(${fleetId}::text, ${candidate.id}::text, ${label.labelId}::text, ${label.valueId}::text)`));
  const ships = candidates.map((candidate) => Prisma.sql`(${fleetId}::text, ${candidate.id}::text, ${candidate.kind}::text, ${candidate.owner}::text)`);
  return prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    WITH ship_labels(fleet_id, ship_id, label_id, value_id) AS (VALUES ${Prisma.join(carried)}),
         candidates(fleet_id, id, kind, owner_ship_id) AS (VALUES ${Prisma.join(ships)})
    SELECT s.id FROM candidates s WHERE ${personPermissionSql(personPermissionPlan(inForce, { subject, verb }))} ORDER BY s.id`);
}

describe('person read permission SQL parity', () => {
  it.each(['read', 'send'] as const)('preserves %s built-ins and positive and negative selector combinations for every actor', async (verb) => {
    // Given open/closed fleets, each built-in actor, and fixed/any/same terms on both sides.
    const settings: RulesInForce[] = [
      { isOpen: true, isViewerReadOn: true, rules: [], declared: [] },
      { isOpen: false, isViewerReadOn: true, rules: [], declared: [] },
      { isOpen: false, isViewerReadOn: false, rules: [], declared: [] },
      ...rules.map((rule) => ({ isOpen: false, isViewerReadOn: false, rules: [rule], declared: [] })),
      { isOpen: false, isViewerReadOn: false, rules: [], declared: [{ fleetId, declarer: { kind: 'installation' }, rules }] },
      { isOpen: false, isViewerReadOn: false, rules: [], declared: [{ fleetId, declarer: { kind: 'ship', shipId: shipId(100) }, rules }] },
    ];
    for (const inForce of settings) {
      for (const subject of subjects) {
        // When Postgres evaluates the compiled plan without materialized reach ids.
        const rows = await reached(subject, { inForce, verb });

        // Then it agrees with the existing permission model, including self-read only.
        const expected = candidates.filter((recipient) => (verb === 'read' && 'id' in subject && subject.id === recipient.id)
          || allowsReach(inForce, { verb, sender: subject, recipient, isAnswerToSender: false })).map(({ id }) => id).sort();
        expect(rows.map(({ id }) => id), JSON.stringify({ subject, inForce, verb })).toEqual(expected);
      }
    }
  });

  it.each([false, true])('keeps SQL syntax bounded with 3000 declarers each holding 20 distinct rules, conjunctions=%s', async (hasConjunctions) => {
    // Given the approved ship/rule density, with each declarer's own distinct values.
    const settings = (count: number): RulesInForce => ({
      isOpen: false,
      isViewerReadOn: false,
      rules: [],
      declared: Array.from({ length: count }, (_, declarer) => ({
        fleetId,
        declarer: { kind: 'ship', shipId: shipId(1000 + declarer) },
        rules: Array.from({ length: 20 }, (_, index): NetworkRule => {
          const number = 1000 + (declarer * 20 + index) * 2;
          const first = declarer === 0 && index === 0 ? red : idSchema('labelValue').parse(`lbv_${String(number).padStart(26, '0')}`);
          const second = declarer === 0 && index === 0 ? blue : idSchema('labelValue').parse(`lbv_${String(number + 1).padStart(26, '0')}`);
          return { verb: 'read', from: [], to: hasConjunctions ? [first, second] : [first] };
        }),
      })),
    });
    const subject: ReachingActor = { kind: 'installation' };
    const small = personPermissionSql(personPermissionPlan(settings(1), { subject, verb: 'read' }));

    // When a dense permission plan is rendered without enumerating recipient ids.
    const dense = settings(3000);
    const startedAt = performance.now();
    const statement = personPermissionSql(personPermissionPlan(dense, { subject, verb: 'read' }));
    const planningMs = performance.now() - startedAt;

    // Then data grows as parameters, never as an unbounded SQL OR tree.
    expect(statement.text.length).toBe(small.text.length);
    expect(statement.values.length).toBe(small.values.length);
    const rows = await reached(subject, { inForce: dense, verb: 'read' });
    expect(rows.map(({ id }) => id)).toEqual(hasConjunctions ? [shipId(70)] : [shipId(2), shipId(5), shipId(8), shipId(11), shipId(14), shipId(17), shipId(70)]);
    console.info({ declarers: 3000, rules: 60000, hasConjunctions, planningMs, sqlBytes: statement.text.length, parameters: statement.values.length });
  });

});
