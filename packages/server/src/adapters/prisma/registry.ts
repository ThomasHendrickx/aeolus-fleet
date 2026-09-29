import type {
  FleetListing,
  FleetRepository,
  InFlightDeliveries,
  LeaseRepository,
  ShipRepository,
} from '../../core/registry/ports.js';
import type { Db } from './client.js';
import { toFleet, toLease, toShip, toShipFacts, toShipFromSql } from './rows.js';

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
    lockName: async (fleetId, name) => {
      // A transaction-level advisory lock on the fleet and the name, released at
      // commit or rollback. Read committed: once the holder commits, the next
      // one's lookup sees the ship it created.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fleetId}), hashtext(${name}))`;
    },
    findActiveByName: async (fleetId, name) => {
      const row = await db.ship.findFirst({ where: { fleetId, name, retiredAt: null } });
      return row ? toShip(row) : undefined;
    },
    findForUpdate: async (fleetId, shipId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, name, type, kind::text AS kind, scopes, note, created_at, retired_at
        FROM ships
        WHERE fleet_id = ${fleetId} AND id = ${shipId}
        FOR UPDATE`;
      return row ? toShipFromSql(row) : undefined;
    },
  };
}

export function createPrismaLeaseRepository(db: Db): LeaseRepository {
  return {
    findOpenForUpdate: async (fleetId, shipId) => {
      const [row] = await db.$queryRaw<unknown[]>`
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
      const [row] = await db.$queryRaw<unknown[]>`
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

export function createPrismaFleetListing(db: Db): FleetListing {
  return {
    ships: async (fleetId) => {
      // One row per ship: at most one lease is open and at most one secret is
      // valid per ship (partial unique indexes), so neither join multiplies rows.
      const rows = await db.$queryRaw<unknown[]>`
        SELECT s.id, s.fleet_id, s.name, s.type, s.kind::text AS kind, s.scopes, s.note, s.created_at, s.retired_at,
               l.id IS NOT NULL AS is_crewed,
               c.issued_at AS secret_issued_at, c.claimed_at AS secret_claimed_at
        FROM ships s
        LEFT JOIN leases l ON l.fleet_id = s.fleet_id AND l.ship_id = s.id AND l.ended_at IS NULL
        LEFT JOIN credentials c ON c.fleet_id = s.fleet_id AND c.ship_id = s.id AND c.invalidated_at IS NULL
        WHERE s.fleet_id = ${fleetId}
        ORDER BY s.id`;
      return rows.map(toShipFacts);
    },
  };
}
