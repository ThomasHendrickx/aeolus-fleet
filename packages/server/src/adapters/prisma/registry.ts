import { PING_CONTENT_TYPE } from '@aeolus-fleet/common';

import type {
  FleetListing,
  FleetRepository,
  InFlightDeliveries,
  LeaseRepository,
  ShipRepository,
} from '../../core/registry/ports.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';
import { toAbandonedDelivery, toDeliveryFromSql, toFleet, toLease, toShip, toShipFacts, toShipFromSql, toShipReport } from './rows.js';

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
      const { commission, ...columns } = ship;
      await db.ship.create({
        data: {
          ...columns,
          scopes: [...ship.scopes],
          commissionedBy: commission?.by ?? null,
          commissionKey: commission?.idempotencyKey ?? null,
          commissionRequestHash: commission?.requestHash ?? null,
        },
      });
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
    lockCommissionKey: async ({ fleetId, by, idempotencyKey }) => {
      // As for a name: a transaction-level advisory lock on the commissioning
      // ship and its key, so the second commission under one key waits and then
      // finds the ship the first one created.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fleetId}), hashtext(${`${by}:${idempotencyKey}`}))`;
    },
    findByCommissionKey: async ({ fleetId, by, idempotencyKey }) => {
      const row = await db.ship.findFirst({ where: { fleetId, commissionedBy: by, commissionKey: idempotencyKey } });
      return row ? toShip(row) : undefined;
    },
    find: async (fleetId, shipId) => {
      const row = await db.ship.findFirst({ where: { fleetId, id: shipId } });
      return row ? toShip(row) : undefined;
    },
    findActiveByName: async (fleetId, name) => {
      const row = await db.ship.findFirst({ where: { fleetId, name, retiredAt: null } });
      return row ? toShip(row) : undefined;
    },
    findForUpdate: async (fleetId, shipId) => {
      // FOR NO KEY UPDATE, not FOR UPDATE: it still makes a second lock on the
      // ship wait, but not the foreign key checks of rows that point at the
      // ship (a new lease, secret or event), so those never deadlock with it.
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, name, type, kind::text AS kind, scopes, note, created_at, retired_at, commissioned_by, commission_key, commission_request_hash
        FROM ships
        WHERE fleet_id = ${fleetId} AND id = ${shipId}
        FOR NO KEY UPDATE`;
      return row ? toShipFromSql(row) : undefined;
    },
    findForShare: async (fleetId, shipId) => {
      // FOR SHARE, not FOR KEY SHARE: it makes a use case that locks the ship
      // FOR NO KEY UPDATE to change it, such as a retire, wait for the send,
      // while other sends to the ship share the lock.
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, name, type, kind::text AS kind, scopes, note, created_at, retired_at, commissioned_by, commission_key, commission_request_hash
        FROM ships
        WHERE fleet_id = ${fleetId} AND id = ${shipId}
        FOR SHARE`;
      return row ? toShipFromSql(row) : undefined;
    },
    findActiveByNameForShare: async (fleetId, name) => {
      // Read committed: a send that waited for a retire checks the ship again
      // once it is free, and no longer finds it by its name.
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, name, type, kind::text AS kind, scopes, note, created_at, retired_at, commissioned_by, commission_key, commission_request_hash
        FROM ships
        WHERE fleet_id = ${fleetId} AND name = ${name} AND retired_at IS NULL
        FOR SHARE`;
      return row ? toShipFromSql(row) : undefined;
    },
    hasActiveShipOfType: async (fleetId, type) => {
      const row = await db.ship.findFirst({ where: { fleetId, type, retiredAt: null }, select: { id: true } });
      return row !== null;
    },
    rename: async ({ fleetId, shipId, name }) => {
      await db.ship.updateMany({ where: { fleetId, id: shipId }, data: { name } });
    },
    retire: async ({ fleetId, shipId, at }) => {
      await db.ship.update({ where: { fleetId_id: { fleetId, id: shipId } }, data: { retiredAt: at } });
    },
  };
}

export function createPrismaLeaseRepository(db: Db): LeaseRepository {
  return {
    findOpenForUpdate: async (fleetId, shipId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, ship_id, location::text AS location, location_description, harness, crew_token_hash,
               started_at, ended_at
        FROM leases
        WHERE fleet_id = ${fleetId} AND ship_id = ${shipId} AND ended_at IS NULL
        FOR UPDATE`;
      return row ? toLease(row) : undefined;
    },
    findOpenForShare: async (fleetId, shipId) => {
      // FOR SHARE, as findOpenByIdForShare: a release waits for the holder.
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, ship_id, location::text AS location, location_description, harness, crew_token_hash,
               started_at, ended_at
        FROM leases
        WHERE fleet_id = ${fleetId} AND ship_id = ${shipId} AND ended_at IS NULL
        FOR SHARE`;
      return row ? toLease(row) : undefined;
    },
    markSeen: async ({ fleetId, leaseId, at }) => {
      // GREATEST keeps an overlapping call that marked it later from moving it back.
      await db.$executeRaw`
        UPDATE leases SET last_seen_at = GREATEST(COALESCE(last_seen_at, ${at}), ${at})
        WHERE fleet_id = ${fleetId} AND id = ${leaseId}`;
    },
    findReportForUpdate: async (fleetId, leaseId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT report_state::text AS report_state, report_note, reported_at
        FROM leases
        WHERE fleet_id = ${fleetId} AND id = ${leaseId} AND ended_at IS NULL
        FOR UPDATE`;
      return row === undefined ? undefined : { report: toShipReport(row) };
    },
    saveReport: async ({ fleetId, leaseId, report }) => {
      await db.lease.updateMany({
        where: { fleetId, id: leaseId },
        data: { reportState: report.state, reportNote: report.note, reportedAt: report.reportedAt },
      });
    },
    findOpenByIdForShare: async (fleetId, leaseId) => {
      // FOR SHARE, not FOR KEY SHARE: ending the lease updates it, so a release
      // or a takeover waits for the holder, while many receives share the lock.
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, ship_id, location::text AS location, location_description, harness, crew_token_hash,
               started_at, ended_at
        FROM leases
        WHERE fleet_id = ${fleetId} AND id = ${leaseId} AND ended_at IS NULL
        FOR SHARE`;
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
          harness: lease.harness,
          crewTokenHash: lease.crewTokenHash,
          startedAt: lease.startedAt,
          endedAt: lease.endedAt,
        },
      });
    },
    end: async ({ fleetId, leaseId, endedAt }) => {
      const [row] = await db.$queryRaw<unknown[]>`
        UPDATE leases SET ended_at = ${endedAt}
        WHERE fleet_id = ${fleetId} AND id = ${leaseId} AND ended_at IS NULL
        RETURNING id, fleet_id, ship_id, location::text AS location, location_description, harness, crew_token_hash,
                  started_at, ended_at`;
      return row ? toLease(row) : undefined;
    },
  };
}

export function createPrismaInFlightDeliveries(db: Db): InFlightDeliveries {
  return {
    returnToPending: async (fleetId, leaseId) => {
      // One statement, on the index of a lease's claims. The lease has just
      // ended in this transaction, after any receive holding it FOR SHARE
      // committed, so read committed sees every claim made under it. Only the
      // claim is cleared: recipient and attempts stay.
      const rows = await db.$queryRaw<unknown[]>`
        WITH returned AS (
          UPDATE deliveries SET state = 'pending', claimed_by_ship_id = NULL, claimed_by_lease_id = NULL
          WHERE fleet_id = ${fleetId} AND claimed_by_lease_id = ${leaseId} AND state = 'delivered'
          RETURNING id, fleet_id, message_id, recipient_ship_id, recipient_type, state::text AS state,
                    claimed_by_ship_id, claimed_by_lease_id, attempts, created_at
        )
        SELECT * FROM returned ORDER BY created_at, id`;
      return rows
        .map(toDeliveryFromSql)
        .map(({ id, messageId, recipient, attempts }) => ({ deliveryId: id, messageId, recipient, attempts }));
    },
    abandonPendingTo: async (fleetId, shipId) => {
      const rows = await db.$queryRaw<unknown[]>`
        UPDATE deliveries SET state = 'abandoned'
        WHERE fleet_id = ${fleetId} AND recipient_ship_id = ${shipId} AND state = 'pending'
        RETURNING id, message_id, created_at`;
      return rows
        .map(toAbandonedDelivery)
        .sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime() || first.deliveryId.localeCompare(second.deliveryId))
        .map(({ deliveryId, messageId }) => ({ deliveryId, messageId }));
    },
  };
}

/** The last model the ship `s` of the outer query stated on a send, and when: its newest message with a model. */
const lastModelOfShip = Prisma.sql`
  SELECT m.model, m.created_at
  FROM messages m
  WHERE m.fleet_id = s.fleet_id AND m.sender_ship_id = s.id AND m.model IS NOT NULL
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 1`;

/**
 * The newest ping to the ship `s` of the outer query: when it was sent, its
 * delivery's state, and when a pong acknowledged it, if one did.
 */
const lastPingOfShip = Prisma.sql`
  SELECT m.created_at AS sent_at, d.state::text AS delivery_state,
         (SELECT e.occurred_at FROM events e
          WHERE e.fleet_id = d.fleet_id AND e.delivery_id = d.id
            AND e.type = 'DeliveryAcknowledged' AND e.details->>'answer' = 'pong'
          ORDER BY e.seq LIMIT 1) AS answered_at
  FROM deliveries d
  JOIN messages m ON m.fleet_id = d.fleet_id AND m.id = d.message_id
  WHERE d.fleet_id = s.fleet_id AND d.recipient_ship_id = s.id AND m.content_type = ${PING_CONTENT_TYPE}
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 1`;

export function createPrismaFleetListing(db: Db): FleetListing {
  return {
    ships: async (fleetId) => {
      // One row per ship: at most one lease is open and at most one secret is
      // valid per ship (partial unique indexes), so neither join multiplies rows.
      const rows = await db.$queryRaw<unknown[]>`
        SELECT s.id, s.fleet_id, s.name, s.type, s.kind::text AS kind, s.scopes, s.note, s.created_at, s.retired_at,
               s.commissioned_by, s.commission_key, s.commission_request_hash,
               l.location::text AS lease_location, l.location_description AS lease_location_description,
               l.harness AS lease_harness, l.started_at AS lease_started_at, l.last_seen_at AS lease_last_seen_at,
               l.report_state::text AS report_state, l.report_note, l.reported_at,
               c.issued_at AS secret_issued_at, c.claimed_at AS secret_claimed_at,
               p.sent_at AS ping_sent_at, p.delivery_state AS ping_delivery_state, p.answered_at AS ping_answered_at,
               lm.model AS last_model, lm.created_at AS last_model_stated_at
        FROM ships s
        LEFT JOIN leases l ON l.fleet_id = s.fleet_id AND l.ship_id = s.id AND l.ended_at IS NULL
        LEFT JOIN credentials c ON c.fleet_id = s.fleet_id AND c.ship_id = s.id AND c.invalidated_at IS NULL
        LEFT JOIN LATERAL (${lastPingOfShip}) p ON true
        LEFT JOIN LATERAL (${lastModelOfShip}) lm ON true
        WHERE s.fleet_id = ${fleetId}
        ORDER BY s.id`;
      return rows.map(toShipFacts);
    },
    deliveryCounts: async (fleetId, shipId) => {
      const [inFlight, open] = await Promise.all([
        db.delivery.count({ where: { fleetId, claimedByShipId: shipId, state: 'delivered' } }),
        db.delivery.count({ where: { fleetId, recipientShipId: shipId, state: { in: ['pending', 'delivered'] } } }),
      ]);
      return { inFlight, open };
    },
    ship: async (fleetId, shipId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT s.id, s.fleet_id, s.name, s.type, s.kind::text AS kind, s.scopes, s.note, s.created_at, s.retired_at,
               s.commissioned_by, s.commission_key, s.commission_request_hash,
               l.location::text AS lease_location, l.location_description AS lease_location_description,
               l.harness AS lease_harness, l.started_at AS lease_started_at, l.last_seen_at AS lease_last_seen_at,
               l.report_state::text AS report_state, l.report_note, l.reported_at,
               c.issued_at AS secret_issued_at, c.claimed_at AS secret_claimed_at,
               p.sent_at AS ping_sent_at, p.delivery_state AS ping_delivery_state, p.answered_at AS ping_answered_at,
               lm.model AS last_model, lm.created_at AS last_model_stated_at
        FROM ships s
        LEFT JOIN leases l ON l.fleet_id = s.fleet_id AND l.ship_id = s.id AND l.ended_at IS NULL
        LEFT JOIN credentials c ON c.fleet_id = s.fleet_id AND c.ship_id = s.id AND c.invalidated_at IS NULL
        LEFT JOIN LATERAL (${lastPingOfShip}) p ON true
        LEFT JOIN LATERAL (${lastModelOfShip}) lm ON true
        WHERE s.fleet_id = ${fleetId} AND s.id = ${shipId}`;
      return row === undefined ? undefined : toShipFacts(row);
    },
  };
}
