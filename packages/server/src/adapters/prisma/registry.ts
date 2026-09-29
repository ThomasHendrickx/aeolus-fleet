import type {
  FleetRepository,
  InFlightDeliveries,
  LeaseRepository,
  ShipRepository,
} from '../../core/registry/ports.js';
import type { Db } from './client.js';
import { toFleet, toLease, toShip, type LeaseSqlRow } from './rows.js';

export function createPrismaFleetRepository(db: Db): FleetRepository {
  return {
    lockInitialisation: async () => {
      // A transaction-level advisory lock on one fixed key: released at commit or rollback.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aeolus:fleet-initialisation'))`;
    },
    count: () => db.fleet.count(),
    list: async () => (await db.fleet.findMany({ orderBy: { id: 'asc' } })).map(toFleet),
    create: async (fleet) => {
      await db.fleet.create({ data: fleet });
    },
  };
}

export function createPrismaShipRepository(db: Db): ShipRepository {
  return {
    create: async (ship) => {
      await db.ship.create({ data: { ...ship, scopes: [...ship.scopes] } });
    },
    findOperatorShip: async (fleetId) => {
      const row = await db.ship.findFirst({ where: { fleetId, kind: 'operator' } });
      return row ? toShip(row) : undefined;
    },
  };
}

export function createPrismaLeaseRepository(db: Db): LeaseRepository {
  return {
    findOpenForUpdate: async (fleetId, shipId) => {
      const [row] = await db.$queryRaw<LeaseSqlRow[]>`
        SELECT id, fleet_id, ship_id, location::text AS location, location_description, started_at, ended_at
        FROM leases
        WHERE fleet_id = ${fleetId} AND ship_id = ${shipId} AND ended_at IS NULL
        FOR UPDATE`;
      return row ? toLease(row) : undefined;
    },
    open: async (lease) => {
      await db.lease.create({
        data: {
          id: lease.id,
          fleetId: lease.fleetId,
          shipId: lease.shipId,
          location: lease.location.kind,
          locationDescription: lease.location.description,
          startedAt: lease.startedAt,
          endedAt: lease.endedAt,
        },
      });
    },
    end: async ({ fleetId, leaseId, endedAt }) => {
      const [row] = await db.$queryRaw<LeaseSqlRow[]>`
        UPDATE leases SET ended_at = ${endedAt}
        WHERE fleet_id = ${fleetId} AND id = ${leaseId} AND ended_at IS NULL
        RETURNING id, fleet_id, ship_id, location::text AS location, location_description, started_at, ended_at`;
      return row ? toLease(row) : undefined;
    },
  };
}

export function createPrismaInFlightDeliveries(db: Db): InFlightDeliveries {
  return {
    returnToPending: async (fleetId, shipId) => {
      const { count } = await db.delivery.updateMany({
        where: { fleetId, claimedByShipId: shipId, state: 'delivered' },
        data: { state: 'pending', claimedByShipId: null },
      });
      return count;
    },
  };
}
