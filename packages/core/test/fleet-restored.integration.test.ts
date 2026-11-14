import { createIdGenerator, SCOPES, type FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { listenForPendingDeliveries } from '../src/adapters/prisma/delivery-notices.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { runServerCommand } from './support/commands.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from './support/core-fixtures.js';
import { createDatabaseMigratedUpTo } from './support/older-schema.js';
import { withOperatorLogin } from './support/operator-login.js';

// fleet:restored, run as the self-hoster runs it after pg_restore: through
// npm, from the repository root, against a real Postgres
// (docs/design/self-hosting-operations.md, section 5).

const newId = createIdGenerator();

let databaseUrl: string;
let prisma: PrismaClient;
let useCases: UseCases;

beforeEach(async () => {
  databaseUrl = await createMigratedDatabase();
  prisma = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma });
});

afterEach(async () => {
  await prisma.$disconnect();
});

function runFleetRestored() {
  return runServerCommand({ script: 'fleet:restored', env: { DATABASE_URL: databaseUrl, PUBLIC_URL: FLEET_URL } });
}

/** The fleet fleet:init made, its argo's sign-in given the tests' email and password. */
async function homeFleet(): Promise<{ fleetId: FleetId; argo: ShipCaller }> {
  const fleet = unwrap(await withOperatorLogin(prisma, useCases.initialiseFleet({ name: 'home fleet' })));
  return { fleetId: fleet.fleetId, argo: operatorCaller(fleet) };
}

/** A second fleet the installation hosts. */
async function awayFleet(): Promise<{ fleetId: FleetId; argo: ShipCaller }> {
  const { fleetId, operatorShipId } = unwrap(await useCases.createFleet({ requestId: newKey(), name: 'away fleet', operatorEmail: 'away@example.com' }));
  return { fleetId, argo: { shipId: operatorShipId, fleetId, kind: 'operator', scopes: [...SCOPES] } };
}

/** A ship of the fleet commissioned and claimed by a session: its crew token. */
async function aCrewedShip(argo: ShipCaller, name: string): Promise<{ crewToken: string; leaseId: string }> {
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  const { leaseId } = unwrap(await useCases.authenticate.byCrewToken(crewToken));
  return { crewToken, leaseId };
}

describe('fleet:restored on Postgres', () => {
  it("ends every open lease but argo's in every fleet, reason restored, and their in-flight deliveries go back to pending", async () => {
    // Given two restored fleets: argo signed in to the first, a crewed ship in each, and a delivery in flight to one
    const home = await homeFleet();
    const away = await awayFleet();
    unwrap(await useCases.signIn(OPERATOR));
    const argoLease = await prisma.lease.findFirstOrThrow({ where: { fleetId: home.fleetId, endedAt: null } });
    const scout = await aCrewedShip(home.argo, 'scout');
    const lookout = await aCrewedShip(away.argo, 'lookout');
    unwrap(
      await useCases.sendMessage(home.argo, { selector: { kind: 'type', type: 'reviewer' }, payload: 'Review it', contentType: 'text/plain', idempotencyKey: newKey() }),
    );
    const scoutCrew = unwrap(await useCases.authenticate.byCrewToken(scout.crewToken));
    const { deliveries } = unwrap(await useCases.receiveDeliveries(scoutCrew, {}));
    expect(deliveries).toHaveLength(1);

    // When the self-hoster runs fleet:restored
    const result = await runFleetRestored();

    // Then every lease but argo's has ended with LeaseRevoked, reason restored, by the system; the delivery is pending again; each old crew token answers LEASE_ENDED
    expect(result).toMatchObject({ code: 0 });
    expect(result.stdout).toContain('Ended 1 lease in fleet home fleet');
    expect(result.stdout).toContain('Ended 1 lease in fleet away fleet');
    await expect(prisma.lease.findMany({ where: { endedAt: null }, select: { id: true } })).resolves.toEqual([{ id: argoLease.id }]);
    const revoked = await prisma.event.findMany({ where: { type: 'LeaseRevoked' } });
    // Each fleet in its own unit of work, in no order the scenario names.
    expect(revoked).toHaveLength(2);
    expect(revoked.map((event) => ({ actor: event.actorKind, details: event.details }))).toEqual(expect.arrayContaining([
      { actor: 'system', details: { leaseId: scout.leaseId, reason: 'restored', returnedDeliveries: 1 } },
      { actor: 'system', details: { leaseId: lookout.leaseId, reason: 'restored', returnedDeliveries: 0 } },
    ]));
    await expect(prisma.delivery.findMany({ select: { state: true, claimedByShipId: true } })).resolves.toEqual([
      { state: 'pending', claimedByShipId: null },
    ]);
    for (const { crewToken } of [scout, lookout]) {
      await expect(useCases.authenticate.byCrewToken(crewToken)).resolves.toMatchObject({ isOk: false, error: { kind: 'LEASE_ENDED' } });
    }
  });

  it('refuses while a core process is connected to the database, and changes nothing', async () => {
    // Given a restored fleet with a crewed ship, and core's delivery listener connected to its database
    const home = await homeFleet();
    const scout = await aCrewedShip(home.argo, 'scout');
    const listener = listenForPendingDeliveries({ databaseUrl, onNotice: () => undefined });
    await listener.listening;

    try {
      // When the self-hoster runs fleet:restored
      const result = await runFleetRestored();

      // Then it refuses, saying to stop core first, and the lease stays open
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('A core process is connected to this database: stop every core process first. Nothing changed.');
      await expect(prisma.lease.findUniqueOrThrow({ where: { id: scout.leaseId } })).resolves.toMatchObject({ endedAt: null });
      await expect(prisma.event.count({ where: { type: 'LeaseRevoked' } })).resolves.toBe(0);
    } finally {
      await listener.close();
    }
  });

  it('migrates a database restored from an older core first, then ends its leases', async () => {
    // Given a backup made by an older core, restored: migrated only up to before sealing_progress, with argo and a crewed ship
    const olderUrl = await createDatabaseMigratedUpTo('20261031090000_recovery_key');
    const older = createPrismaClient(olderUrl);
    const fleetId = newId('fleet');
    const argoId = newId('ship');
    const scoutId = newId('ship');
    const leaseId = newId('lease');
    const now = new Date();
    try {
      // Raw: the generated client knows columns that later migrations add.
      await older.$executeRaw`INSERT INTO fleets (id, name, created_at) VALUES (${fleetId}, 'old fleet', ${now})`;
      await older.$executeRaw`
        INSERT INTO ships (id, fleet_id, name, type, kind, scopes, created_at) VALUES
          (${argoId}, ${fleetId}, 'argo', 'operator', 'operator', '{}', ${now}),
          (${scoutId}, ${fleetId}, 'scout', 'reviewer', 'agent', '{}', ${now})`;
      await older.$executeRaw`
        INSERT INTO leases (id, fleet_id, ship_id, location, crew_token_hash, started_at)
        VALUES (${leaseId}, ${fleetId}, ${scoutId}, 'CLOUD', ${newKey()}, ${now})`;
    } finally {
      await older.$disconnect();
    }

    // When the self-hoster runs fleet:restored, with the newer core installed
    const result = await runServerCommand({ script: 'fleet:restored', env: { DATABASE_URL: olderUrl, PUBLIC_URL: FLEET_URL } });

    // Then it migrates what the backup lacks, and ends the ship's lease with LeaseRevoked, reason restored
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('Ended 1 lease in fleet old fleet');
    const migrated = createPrismaClient(olderUrl);
    try {
      await expect(migrated.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20261113120000_events_owner_set_index' AND finished_at IS NOT NULL`).resolves.toHaveLength(1);
      expect((await migrated.lease.findUniqueOrThrow({ where: { id: leaseId } })).endedAt).not.toBeNull();
      await expect(migrated.event.findMany({ where: { type: 'LeaseRevoked' }, select: { actorKind: true, details: true } })).resolves.toEqual([
        { actorKind: 'system', details: { leaseId, reason: 'restored', returnedDeliveries: 0 } },
      ]);
    } finally {
      await migrated.$disconnect();
    }
  });
});
