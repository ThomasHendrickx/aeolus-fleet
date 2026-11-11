import { idSchema, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { ruleMatchPermissionSql } from '../src/adapters/prisma/rule-match-permission.js';
import { createPrismaRuleMatchRepository } from '../src/adapters/prisma/rule-matches.js';
import { allowsReach } from '../src/domain/registry/network-settings.js';
import { everyCandidateVerbsOf, ruleMatchFilterOf, ruleMatchesOf, ruleSourcesOf, MATCHED_VERBS } from '../src/domain/registry/rule-matches.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { aGeneratedRuleFleet, declarersOfCarried, type GeneratedRuleFleet } from './support/generated-rule-fleets.js';

const GENERATED_FLEETS = 200;
const fleetId = idSchema('fleet').parse('flt_00000000000000000000000001');

/** Thrown to end a seed's transaction, so every generated fleet starts from an empty database. */
class SeedDone extends Error {}

let prisma: PrismaClient;
beforeAll(async () => {
  prisma = createPrismaClient(await createMigratedDatabase());
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function storeFleet(db: Prisma.TransactionClient, fleet: GeneratedRuleFleet): Promise<void> {
  await db.$executeRaw`INSERT INTO fleets (id, name, created_at) VALUES (${fleetId}, 'generated', now())`;
  await db.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, kind, scopes, created_at, owner_ship_id)
    VALUES ${Prisma.join(fleet.ships.map((ship) => Prisma.sql`(${ship.id}, ${fleetId}, ${ship.kind === 'operator' ? 'argo' : ship.id}, 'generated', ${ship.kind}::ship_kind, '{}', now(), ${ship.owner})`))}`;
  for (const label of fleet.labels) {
    const ownerShipId = label.owner.kind === 'ship' ? label.owner.shipId : null;
    await db.$executeRaw`INSERT INTO labels (id, fleet_id, key, owner_kind, owner_ship_id) VALUES (${label.id}, ${fleetId}, ${label.key}, ${label.owner.kind}::label_owner_kind, ${ownerShipId})`;
    await db.$executeRaw`
      INSERT INTO label_values (id, fleet_id, label_id, value, position)
      VALUES ${Prisma.join(label.values.map((valueId, position) => Prisma.sql`(${valueId}, ${fleetId}, ${label.id}, ${valueId}, ${position})`))}`;
  }
  const carried = fleet.ships.flatMap((ship) => ship.labels.map((label) => Prisma.sql`(${fleetId}, ${ship.id}, ${label.labelId}, ${label.valueId})`));
  if (carried.length > 0) {
    await db.$executeRaw`INSERT INTO ship_labels (fleet_id, ship_id, label_id, value_id) VALUES ${Prisma.join(carried)}`;
  }
  const matches = fleet.ships.flatMap((ship) => ruleMatchesOf(ship, ruleSourcesOf(fleet.inForce, declarersOfCarried(fleet, ship.labels))));
  await createPrismaRuleMatchRepository(db).replaceOfShips(fleetId, { shipIds: fleet.ships.map(({ id }) => id), matches });
}

describe('rule matches in Postgres', () => {
  it('decide every subject and candidate of a generated fleet as the network rules do', async () => {
    const mismatches: string[] = [];
    for (let seed = 1; seed <= GENERATED_FLEETS; seed += 1) {
      const fleet = aGeneratedRuleFleet(seed);
      try {
        await prisma.$transaction(async (db) => {
          // Given a generated fleet stored with its rule matches.
          await storeFleet(db, fleet);
          for (const subject of fleet.subjects) {
            const carried = subject.kind === 'installation' ? [] : subject.labels;
            const rules = {
              isOpen: fleet.inForce.isOpen,
              isViewerReadOn: fleet.inForce.isViewerReadOn,
              sources: ruleSourcesOf(fleet.inForce, declarersOfCarried(fleet, carried)),
              everyCandidateVerbs: everyCandidateVerbsOf(fleet.inForce.declared),
            };
            for (const verb of MATCHED_VERBS) {
              // When Postgres decides every candidate from the subject's filter and the stored matches.
              const filter = ruleMatchFilterOf(rules, { subject, verb });
              const rows = await db.$queryRaw<{ id: ShipId }[]>`
                SELECT s.id FROM ships s WHERE s.fleet_id = ${fleetId} AND ${ruleMatchPermissionSql(filter)} ORDER BY s.id`;

              // Then it grants exactly the candidates the network rules do, a ship reading itself included.
              const expected = fleet.ships
                .filter((candidate) => (verb === 'read' && 'id' in subject && subject.id === candidate.id)
                  || allowsReach(fleet.inForce, { verb, sender: subject, recipient: candidate, isAnswerToSender: false }))
                .map(({ id }) => id)
                .sort();
              const granted = rows.map(({ id }) => id);
              if (JSON.stringify(granted) !== JSON.stringify(expected)) {
                mismatches.push(JSON.stringify({ seed, verb, subject, granted, expected }));
              }
            }
          }
          throw new SeedDone();
        }, { timeout: 60_000 });
      } catch (error) {
        if (!(error instanceof SeedDone)) {
          throw error;
        }
      }
    }
    expect(mismatches.slice(0, 3)).toEqual([]);
  }, 300_000);
});
