import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClientTellingStatements, type PrismaClient } from '../src/adapters/prisma/client.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createTestClock } from './support/postgres-core.js';

// Read reach at the target size (#1646; performance design, decision 5): a
// fleet of 3,000 active ships and as many retired, a read rule in force, so
// a ship's read works out its reach rule by rule. Production showed the cost
// growing with every ship the fleet ever had: a query per ship for the
// labels it carries. The statements are counted, not timed, which would
// flake under load; staging measures the time.

const SHIPS = 3_000;

let prisma: PrismaClient;
let useCases: UseCases;
let fleetId: FleetId;
let reader: ShipCaller;
const statements: string[] = [];

/** A ship argo commissions and a session claims, as the caller it is. */
async function crewed(argo: ShipCaller, ship: { name: string; type: string }): Promise<ShipCaller> {
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), ...ship, scopes: ['fleet:read', 'fleet:network'] }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return unwrap(await useCases.authenticate.byCrewToken(crewToken));
}

beforeAll(async () => {
  prisma = createPrismaClientTellingStatements(await createMigratedDatabase(), (statement) => statements.push(statement));
  useCases = createUseCases({ prisma, clock: createTestClock('2026-11-04T07:00:00.000Z') });
  const argo = operatorCaller(unwrap(await withOperatorLogin(prisma, useCases.initialiseFleet({ name: 'home fleet' }))));
  fleetId = argo.fleetId;
  reader = await crewed(argo, { name: 'reader', type: 'reader' });

  const team = unwrap(await useCases.defineLabel(argo, { key: 'team', values: ['a'] }));
  const [teamA] = team.values.map((value) => value.id);
  if (teamA === undefined) {
    throw new Error('the team label has no value a');
  }
  unwrap(await useCases.assignLabel(argo, { shipId: reader.shipId, valueId: teamA }));
  await prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes, retired_at)
    SELECT 'shp_0' || lpad(i::text, 25, '0'), ${fleetId}, 'ship-' || i, 'agent', now(), 'agent', '{}', CASE WHEN i > ${SHIPS}::int THEN now() END
    FROM generate_series(1, ${2 * SHIPS}::int) i`;
  await prisma.$executeRaw`
    INSERT INTO ship_labels (fleet_id, ship_id, label_id, value_id)
    SELECT ${fleetId}, 'shp_0' || lpad(i::text, 25, '0'), ${team.labelId}, ${teamA}
    FROM generate_series(1, ${SHIPS}::int) i WHERE i % 2 = 0`;
  const { savedAgainstVersion } = unwrap(
    await useCases.saveNetworkRulesDraft(reader, { rules: [{ verb: 'read', from: [teamA], to: [teamA] }, { verb: 'send', from: [], to: [] }, { verb: 'manage', from: [], to: [] }] }),
  );
  unwrap(await useCases.applyNetworkRules(reader, { version: savedAgainstVersion }));
  await prisma.$executeRaw`ANALYZE`;
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('read reach at 3,000 active and 3,000 retired ships', () => {
  it('reads the labels in two statements, its own and the fleet\'s, not one per ship', async () => {
    // Given a fleet of 6,000 ships, half of the active ones in team a, and a read rule letting team a read team a.
    statements.length = 0;

    // When the reader reads Harbour.
    const { counts } = await useCases.readHarbour(reader);

    // Then it reads itself and the 1,500 ships of team a, reading ship_labels twice: its own labels, as the reader, and the fleet's.
    expect([counts?.ships, statements.filter((statement) => statement.includes('"ship_labels"')).length]).toEqual([1_501, 2]);
  });
});
