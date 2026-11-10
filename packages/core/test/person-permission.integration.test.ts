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
});
