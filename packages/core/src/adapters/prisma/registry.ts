import { PING_CONTENT_TYPE, idSchema, type FleetId, type LabelId, type ShipId } from '@aeolus-fleet/common';

import type {
  ClearRequestRepository,
  CrewRequestRepository,
  FleetListing,
  LabelRepository,
  FleetRepository,
  InFlightDeliveries,
  LeaseRepository,
  ShipRepository,
} from '../../domain/registry/ports.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';
import {
  toAbandonedDelivery,
  toClearRequest,
  toCrewRequest,
  toDeliveryFromSql,
  toFleet,
  toLabelFromSql,
  toLease,
  toListedLabel,
  toLeaseShipId,
  toShip,
  toShipFacts,
  toShipFromSql,
  toShipLabel,
  toShipReport,
} from './rows.js';

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
    limitSettings: async (fleetId) => {
      const row = await db.fleet.findUnique({ where: { id: fleetId }, select: { shipLimitSet: true, shipLimit: true, dailyMessageLimitSet: true, dailyMessageLimit: true } });
      if (!row) {
        return undefined;
      }
      return {
        ships: row.shipLimitSet ? { kind: 'fleet', limit: row.shipLimit } : { kind: 'default' },
        dailyMessages: row.dailyMessageLimitSet ? { kind: 'fleet', limit: row.dailyMessageLimit } : { kind: 'default' },
      };
    },
    setLimitSettings: async (fleetId, settings) => {
      await db.fleet.update({
        where: { id: fleetId },
        data: {
          shipLimitSet: settings.ships.kind === 'fleet',
          shipLimit: settings.ships.kind === 'fleet' ? settings.ships.limit : null,
          dailyMessageLimitSet: settings.dailyMessages.kind === 'fleet',
          dailyMessageLimit: settings.dailyMessages.kind === 'fleet' ? settings.dailyMessages.limit : null,
        },
      });
    },
    findForUpdate: async (fleetId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, name, created_at AS "createdAt" FROM fleets WHERE id = ${fleetId} FOR UPDATE`;
      return row === undefined ? undefined : toFleet(row);
    },
    delete: async (fleetId) => {
      // Events are append-only; naming the fleet for this transaction alone lets
      // its events go with it, and no other fleet's (decision 0020).
      await db.$queryRaw`SELECT set_config('aeolus.deleting_fleet', ${fleetId}, true)`;
      // Children first: every foreign key restricts deletes. A message may answer
      // or resend another of the fleet, so those links go before the messages.
      await db.$executeRaw`DELETE FROM events WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM deliveries WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`UPDATE messages SET in_reply_to_message_id = NULL, resend_of_message_id = NULL WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM messages WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM notice_dismissals WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM guide_progress WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM console_sessions WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM sign_in_tickets WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM credentials WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM crew_request_give_backs WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM crew_requests WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM worktree_clear_requests WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM network_settings WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM reach_refusals WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM ship_labels WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM label_values WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM labels WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM leases WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM ships WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM operators WHERE fleet_id = ${fleetId}`;
      // The request that created the fleet names it, so it goes too; a delete's record names nothing of it.
      await db.$executeRaw`DELETE FROM installation_requests WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM fleets WHERE id = ${fleetId}`;
    },
  };
}

export function createPrismaCrewRequestRepository(db: Db): CrewRequestRepository {
  const withGivenBack = { givenBack: { orderBy: { givenBackAt: 'asc' } } } as const;
  return {
    find: async (fleetId, shipId) => {
      const row = await db.crewRequest.findUnique({ where: { fleetId_shipId: { fleetId, shipId } }, include: withGivenBack });
      return row === null ? undefined : toCrewRequest(row);
    },
    save: async ({ fleetId, shipId, settings, settingsVersion, requestedAt, assignedTo, status, reason, attempt, sessionStartedAt, isFinal, givenBack }) => {
      await db.crewRequest.upsert({
        where: { fleetId_shipId: { fleetId, shipId } },
        create: { fleetId, shipId, settings, settingsVersion, requestedAt, assignedTo, status, reason, attempt, sessionStartedAt, isFinal },
        update: { settings, settingsVersion, requestedAt, assignedTo, status, reason, attempt, sessionStartedAt, isFinal },
      });
      // The request holds its give-backs whole: what it saves replaces what it held.
      await db.crewRequestGiveBack.deleteMany({ where: { fleetId, shipId } });
      await db.crewRequestGiveBack.createMany({ data: givenBack.map((back) => ({ fleetId, shipId, ...back })) });
    },
    listAssignedTo: async (fleetId, trierarchShipId) => {
      const rows = await db.crewRequest.findMany({ where: { fleetId, assignedTo: trierarchShipId }, orderBy: { shipId: 'asc' }, include: withGivenBack });
      return rows.map(toCrewRequest);
    },
    remove: async (fleetId, shipId) => {
      await db.crewRequestGiveBack.deleteMany({ where: { fleetId, shipId } });
      await db.crewRequest.deleteMany({ where: { fleetId, shipId } });
    },
  };
}

export function createPrismaClearRequestRepository(db: Db): ClearRequestRepository {
  const where = (fleetId: FleetId, { trierarchShipId, shipId, repository }: { trierarchShipId: ShipId; shipId: ShipId; repository: string }) => ({
    fleetId_trierarchShipId_shipId_repository: { fleetId, trierarchShipId, shipId, repository },
  });
  return {
    find: async (fleetId, key) => {
      const row = await db.worktreeClearRequest.findUnique({ where: where(fleetId, key) });
      return row === null ? undefined : toClearRequest(row);
    },
    save: async (request) => {
      await db.worktreeClearRequest.create({ data: request });
    },
    remove: async (fleetId, key) => {
      await db.worktreeClearRequest.deleteMany({ where: { fleetId, trierarchShipId: key.trierarchShipId, shipId: key.shipId, repository: key.repository } });
    },
    list: async (fleetId) => {
      const rows = await db.worktreeClearRequest.findMany({ where: { fleetId }, orderBy: [{ trierarchShipId: 'asc' }, { requestedAt: 'asc' }] });
      return rows.map(toClearRequest);
    },
    listFor: async (fleetId, trierarchShipId) => {
      const rows = await db.worktreeClearRequest.findMany({ where: { fleetId, trierarchShipId }, orderBy: { requestedAt: 'asc' } });
      return rows.map(toClearRequest);
    },
  };
}

/** A label's columns, read from `labels l`, with its values in their order as one JSON array. */
const labelColumns = Prisma.sql`
  l.fleet_id, l.id, l.key, l.owner_ship_id,
  COALESCE((SELECT json_agg(json_build_object('id', v.id, 'value', v.value) ORDER BY v.position)
            FROM label_values v WHERE v.fleet_id = l.fleet_id AND v.label_id = l.id), '[]'::json) AS values`;

export function createPrismaLabelRepository(db: Db): LabelRepository {
  const findLabel = async ({ fleetId, labelId }: { fleetId: FleetId; labelId: LabelId }, lock: Prisma.Sql) => {
    const [row] = await db.$queryRaw<unknown[]>`SELECT ${labelColumns} FROM labels l WHERE l.fleet_id = ${fleetId} AND l.id = ${labelId} ${lock}`;
    return row === undefined ? undefined : toLabelFromSql(row);
  };
  return {
    lockKey: async (fleetId, key) => {
      // As for a ship's name: a transaction-level advisory lock on the fleet and
      // the key, so the second definition of one key waits and then finds it.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fleetId}), hashtext(${`label:${key}`}))`;
    },
    findByKey: async (fleetId, key) => {
      const [row] = await db.$queryRaw<unknown[]>`SELECT ${labelColumns} FROM labels l WHERE l.fleet_id = ${fleetId} AND l.key = ${key}`;
      return row === undefined ? undefined : toLabelFromSql(row);
    },
    find: (fleetId, labelId) => findLabel({ fleetId, labelId }, Prisma.empty),
    // FOR NO KEY UPDATE: a change of values waits for the assignments holding
    // the label, and they for it; the label itself stays.
    findForUpdate: (fleetId, labelId) => findLabel({ fleetId, labelId }, Prisma.sql`FOR NO KEY UPDATE`),
    findByValueForShare: async (fleetId, valueId) => {
      // FOR SHARE: a change of values, a delete and a retire wait for the
      // assignment, while other assignments of the label share the lock. The
      // label is read again after the lock, so values a change removed while
      // this waited are gone from it.
      const [held] = await db.$queryRaw<{ id: string }[]>`
        SELECT l.id FROM labels l
        JOIN label_values v ON v.fleet_id = l.fleet_id AND v.label_id = l.id
        WHERE l.fleet_id = ${fleetId} AND v.id = ${valueId}
        FOR SHARE OF l`;
      return held === undefined ? undefined : findLabel({ fleetId, labelId: idSchema('label').parse(held.id) }, Prisma.empty);
    },
    listOwnedByForUpdate: async (fleetId, ownerShipId) => {
      // FOR UPDATE: the label goes, so new assignments of it wait and then find it gone.
      const rows = await db.$queryRaw<unknown[]>`
        SELECT ${labelColumns} FROM labels l
        WHERE l.fleet_id = ${fleetId} AND l.owner_ship_id = ${ownerShipId}
        ORDER BY l.key
        FOR UPDATE OF l`;
      return rows.map(toLabelFromSql);
    },
    save: async ({ fleetId, id, key, values, ownerShipId }) => {
      await db.label.upsert({ where: { id }, create: { id, fleetId, key, ownerShipId }, update: {} });
      await db.labelValue.deleteMany({ where: { fleetId, labelId: id, id: { notIn: values.map((value) => value.id) } } });
      for (const [position, value] of values.entries()) {
        await db.labelValue.upsert({
          where: { id: value.id },
          create: { id: value.id, fleetId, labelId: id, value: value.value, position },
          update: { position },
        });
      }
    },
    remove: async (fleetId, labelId) => {
      await db.labelValue.deleteMany({ where: { fleetId, labelId } });
      await db.label.deleteMany({ where: { fleetId, id: labelId } });
    },
    carriedBy: async (fleetId, shipId) => (await db.shipLabel.findMany({ where: { fleetId, shipId }, orderBy: { valueId: 'asc' } })).map(toShipLabel),
    carriersOf: async (fleetId, labelId) =>
      (await db.shipLabel.findMany({ where: { fleetId, labelId }, orderBy: [{ shipId: 'asc' }, { valueId: 'asc' }] })).map(toShipLabel),
    assign: async (assignment) => {
      await db.shipLabel.create({ data: assignment });
    },
    unassign: async ({ fleetId, shipId, valueId }) => {
      await db.shipLabel.deleteMany({ where: { fleetId, shipId, valueId } });
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
    findViewerShip: async (fleetId) => {
      const row = await db.ship.findFirst({ where: { fleetId, kind: 'viewer' } });
      return row ? toShip(row) : undefined;
    },
    lockName: async (fleetId, name) => {
      // A transaction-level advisory lock on the fleet and the name, released at
      // commit or rollback. Read committed: once the holder commits, the next
      // one's lookup sees the ship it created.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fleetId}), hashtext(${name}))`;
    },
    lockShipCount: async (fleetId) => {
      // A transaction-level advisory lock on the fleet's ship count, released at commit or rollback.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ship-count'), hashtext(${fleetId}))`;
    },
    countActive: (fleetId) => db.ship.count({ where: { fleetId, retiredAt: null } }),
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
    listActiveOfType: async (fleetId, type) =>
      (await db.ship.findMany({ where: { fleetId, type, retiredAt: null, kind: { not: 'viewer' } }, orderBy: { id: 'asc' } })).map(toShip),
    hasActiveShipOfType: async (fleetId, type) => {
      const row = await db.ship.findFirst({ where: { fleetId, type, retiredAt: null, kind: { not: 'viewer' } }, select: { id: true } });
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
        SELECT report_state::text AS report_state, report_note, reported_at, report_details, report_details_version
        FROM leases
        WHERE fleet_id = ${fleetId} AND id = ${leaseId} AND ended_at IS NULL
        FOR UPDATE`;
      return row === undefined ? undefined : { report: toShipReport(row) };
    },
    findReportLog: async (fleetId, leaseId) => {
      const [own] = await db.$queryRaw<unknown[]>`
        SELECT ship_id, report_state::text AS report_state, report_note, reported_at, report_details, report_details_version
        FROM leases
        WHERE fleet_id = ${fleetId} AND id = ${leaseId} AND ended_at IS NULL`;
      if (own === undefined) {
        return undefined;
      }
      const shipId = toLeaseShipId(own);
      // The previous crew: the ship's lease that ended last before this one.
      const [previous] = await db.$queryRaw<unknown[]>`
        SELECT report_state::text AS report_state, report_note, reported_at, report_details, report_details_version
        FROM leases
        WHERE fleet_id = ${fleetId} AND ship_id = ${shipId} AND id <> ${leaseId} AND ended_at IS NOT NULL
        ORDER BY ended_at DESC, id DESC
        LIMIT 1`;
      return { report: toShipReport(own), previousCrew: previous === undefined ? null : toShipReport(previous) };
    },
    saveReport: async ({ fleetId, leaseId, report }) => {
      await db.lease.updateMany({
        where: { fleetId, id: leaseId },
        data: {
          reportState: report.state,
          reportNote: report.note,
          reportedAt: report.reportedAt,
          // DbNull: no details is SQL NULL, not the JSON value null.
          reportDetails: report.details ?? Prisma.DbNull,
          reportDetailsVersion: report.detailsVersion,
        },
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

/**
 * The last model the ship `s` of the outer query stated on a send, and when:
 * its newest message with a model that its sessions sent. A resend is the
 * operator's, under the original sender, so it never counts.
 */
const lastModelOfShip = Prisma.sql`
  SELECT m.model, m.created_at
  FROM messages m
  WHERE m.fleet_id = s.fleet_id AND m.sender_ship_id = s.id AND m.model IS NOT NULL AND m.resend_of_message_id IS NULL
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

/**
 * Who crewed the ship: the ship that got the starting prompt its open lease
 * claimed with, the actor of its last StartingPromptIssued before the lease
 * started. None while no lease is open.
 */
/**
 * The label values the ship carries, each with its label, by key then value,
 * as one JSON array. An empty array for a ship without labels.
 */
const labelsOfShip = Prisma.sql`
  COALESCE((SELECT json_agg(json_build_object('labelId', sl.label_id, 'key', lb.key, 'valueId', sl.value_id, 'value', v.value) ORDER BY lb.key, v.value)
            FROM ship_labels sl
            JOIN labels lb ON lb.fleet_id = sl.fleet_id AND lb.id = sl.label_id
            JOIN label_values v ON v.fleet_id = sl.fleet_id AND v.id = sl.value_id
            WHERE sl.fleet_id = s.fleet_id AND sl.ship_id = s.id), '[]'::json)`;

const givenBackOfShip = Prisma.sql`
  COALESCE((SELECT json_agg(json_build_object('trierarchShipId', g.trierarch_ship_id, 'trierarchName', t.name, 'settingsVersion', g.settings_version,
                                              'reason', g.reason, 'givenBackAt', g.given_back_at) ORDER BY g.given_back_at, g.trierarch_ship_id)
            FROM crew_request_give_backs g
            JOIN ships t ON t.fleet_id = g.fleet_id AND t.id = g.trierarch_ship_id
            WHERE g.fleet_id = s.fleet_id AND g.ship_id = s.id), '[]'::json)`;

const crewedByOfShip = Prisma.sql`
  SELECT a.id, a.name
  FROM events e
  JOIN ships a ON a.fleet_id = e.fleet_id AND a.id = e.actor_ship_id
  WHERE l.id IS NOT NULL AND e.fleet_id = s.fleet_id AND e.ship_id = s.id
    AND e.type = 'StartingPromptIssued' AND e.occurred_at <= l.started_at
  ORDER BY e.seq DESC
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
               l.report_state::text AS report_state, l.report_note, l.reported_at, l.report_details, l.report_details_version,
               c.issued_at AS secret_issued_at, c.claimed_at AS secret_claimed_at,
               cr.settings AS crew_request_settings, cr.settings_version AS crew_request_settings_version,
               cr.requested_at AS crew_request_requested_at, cr.assigned_to_ship_id AS crew_request_assigned_to,
               cr.status::text AS crew_request_status, ca.name AS crew_request_assignee_name, cr.reason AS crew_request_reason, cr.attempt AS crew_request_attempt, cr.session_started_at AS crew_request_session_started_at, cr.is_final AS crew_request_is_final,
               cb.id AS crewed_by_id, cb.name AS crewed_by_name,
               p.sent_at AS ping_sent_at, p.delivery_state AS ping_delivery_state, p.answered_at AS ping_answered_at,
               lm.model AS last_model, lm.created_at AS last_model_stated_at,
               (SELECT max(cs.last_used_at) FROM console_sessions cs
                 WHERE cs.fleet_id = s.fleet_id AND cs.ship_id = s.id AND cs.lease_id IS NULL) AS last_viewed_at,
               (SELECT max(el.ended_at) FROM leases el
                 WHERE el.fleet_id = s.fleet_id AND el.ship_id = s.id AND el.ended_at IS NOT NULL) AS last_lease_ended_at,
               ${labelsOfShip} AS labels, ${givenBackOfShip} AS crew_request_given_back
        FROM ships s
        LEFT JOIN leases l ON l.fleet_id = s.fleet_id AND l.ship_id = s.id AND l.ended_at IS NULL
        LEFT JOIN credentials c ON c.fleet_id = s.fleet_id AND c.ship_id = s.id AND c.invalidated_at IS NULL
        LEFT JOIN crew_requests cr ON cr.fleet_id = s.fleet_id AND cr.ship_id = s.id
        LEFT JOIN ships ca ON ca.fleet_id = cr.fleet_id AND ca.id = cr.assigned_to_ship_id
        LEFT JOIN LATERAL (${crewedByOfShip}) cb ON true
        LEFT JOIN LATERAL (${lastPingOfShip}) p ON true
        LEFT JOIN LATERAL (${lastModelOfShip}) lm ON true
        WHERE s.fleet_id = ${fleetId}
        ORDER BY s.id`;
      return rows.map(toShipFacts);
    },
    labels: async (fleetId) => {
      const rows = await db.$queryRaw<unknown[]>`
        SELECT ${labelColumns}, o.name AS owner_name
        FROM labels l
        JOIN ships o ON o.fleet_id = l.fleet_id AND o.id = l.owner_ship_id
        WHERE l.fleet_id = ${fleetId}
        ORDER BY l.key`;
      return rows.map(toListedLabel);
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
               l.report_state::text AS report_state, l.report_note, l.reported_at, l.report_details, l.report_details_version,
               c.issued_at AS secret_issued_at, c.claimed_at AS secret_claimed_at,
               cr.settings AS crew_request_settings, cr.settings_version AS crew_request_settings_version,
               cr.requested_at AS crew_request_requested_at, cr.assigned_to_ship_id AS crew_request_assigned_to,
               cr.status::text AS crew_request_status, ca.name AS crew_request_assignee_name, cr.reason AS crew_request_reason, cr.attempt AS crew_request_attempt, cr.session_started_at AS crew_request_session_started_at, cr.is_final AS crew_request_is_final,
               cb.id AS crewed_by_id, cb.name AS crewed_by_name,
               p.sent_at AS ping_sent_at, p.delivery_state AS ping_delivery_state, p.answered_at AS ping_answered_at,
               lm.model AS last_model, lm.created_at AS last_model_stated_at,
               (SELECT max(cs.last_used_at) FROM console_sessions cs
                 WHERE cs.fleet_id = s.fleet_id AND cs.ship_id = s.id AND cs.lease_id IS NULL) AS last_viewed_at,
               (SELECT max(el.ended_at) FROM leases el
                 WHERE el.fleet_id = s.fleet_id AND el.ship_id = s.id AND el.ended_at IS NOT NULL) AS last_lease_ended_at,
               ${labelsOfShip} AS labels, ${givenBackOfShip} AS crew_request_given_back
        FROM ships s
        LEFT JOIN leases l ON l.fleet_id = s.fleet_id AND l.ship_id = s.id AND l.ended_at IS NULL
        LEFT JOIN credentials c ON c.fleet_id = s.fleet_id AND c.ship_id = s.id AND c.invalidated_at IS NULL
        LEFT JOIN crew_requests cr ON cr.fleet_id = s.fleet_id AND cr.ship_id = s.id
        LEFT JOIN ships ca ON ca.fleet_id = cr.fleet_id AND ca.id = cr.assigned_to_ship_id
        LEFT JOIN LATERAL (${crewedByOfShip}) cb ON true
        LEFT JOIN LATERAL (${lastPingOfShip}) p ON true
        LEFT JOIN LATERAL (${lastModelOfShip}) lm ON true
        WHERE s.fleet_id = ${fleetId} AND s.id = ${shipId}`;
      return row === undefined ? undefined : toShipFacts(row);
    },
  };
}
