import { PING_CONTENT_TYPE, idSchema, scopeNameSchema, type FleetId, type LabelId, type ShipId, type ShipPosition, type ShipStatus } from '@aeolus-fleet/common';

import { z } from 'zod';

import type {
  ClearRequestRepository,
  CrewRequestRepository,
  FleetListing,
  ShipPage,
  LabelRepository,
  FleetRepository,
  InFlightDeliveries,
  LeaseRepository,
  ShipRepository,
} from '../../domain/registry/ports.js';
import type { ShipFilter } from '@aeolus-fleet/common/rules';
import { COLUMNS_SHOWN_OUTSIDE_READ_REACH, isValueDescending, type ShipSort } from '../../domain/registry/ship-order.js';
import type { ReadReach } from '../../domain/registry/read-reach.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';
import {
  commissionerColumns,
  toAbandonedDelivery,
  toClearRequest,
  toCrewRequest,
  toDeliveryFromSql,
  toFleet,
  toLastSeen,
  toLabelFromSql,
  toLease,
  toListedLabel,
  toLeaseShipId,
  toShip,
  toShipFacts,
  toShipFromSql,
  toShipLabel,
  toShipReport,
  toStatedStatement,
  toTurn,
} from './rows.js';
import { readShipCounts } from './ship-counts.js';

export function createPrismaFleetRepository(db: Db): FleetRepository {
  return {
    lockInitialisation: async () => {
      // A transaction-level advisory lock on one fixed key: released at commit or rollback.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aeolus:fleet-initialisation'))`;
    },
    count: () => db.fleet.count(),
    find: async (fleetId) => {
      const row = await db.fleet.findUnique({ where: { id: fleetId } });
      return row ? toFleet(row) : undefined;
    },
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
      await db.$executeRaw`DELETE FROM health_snapshot_deliveries WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM health_snapshots WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM events WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM overdue_deliveries WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM deliveries WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`UPDATE messages SET in_reply_to_message_id = NULL, resend_of_message_id = NULL WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM messages WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM message_days WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM notice_dismissals WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM guide_progress WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM account_notice_dismissals WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM account_guide_progress WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM console_sessions WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM sign_in_tickets WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM credentials WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM crew_request_give_backs WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM crew_requests WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM worktree_clear_requests WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM network_settings WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM network_rules_drafts WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM reach_refusals WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM declared_network_rules WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM installation_declared_network_rules WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM scope_namespaces WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM verified_facts WHERE fleet_id = ${fleetId}`;
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
    listNamedBy: async (fleetId, { labelIds, valueIds }) => {
      const rows = await db.$queryRaw<unknown[]>`
        SELECT ${labelColumns} FROM labels l
        WHERE l.fleet_id = ${fleetId}
          AND (l.id = ANY(${[...labelIds]}::text[])
               OR EXISTS (SELECT 1 FROM label_values v WHERE v.fleet_id = l.fleet_id AND v.label_id = l.id AND v.id = ANY(${[...valueIds]}::text[])))
        ORDER BY l.key`;
      return rows.map(toLabelFromSql);
    },
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
    save: async ({ fleetId, id, key, values, owner }) => {
      const ownerColumns = owner.kind === 'ship' ? { ownerKind: owner.kind, ownerShipId: owner.shipId } : { ownerKind: owner.kind };
      await db.label.upsert({ where: { id }, create: { id, fleetId, key, ...ownerColumns }, update: {} });
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
      const { commission, owner, ...columns } = ship;
      await db.ship.create({
        data: {
          ...columns,
          ownerShipId: owner,
          scopes: [...ship.scopes],
          ...commissionerColumns(commission?.by),
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
      const { commissionedByKind, commissionedBy } = commissionerColumns(by);
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fleetId}), hashtext(${`${String(commissionedByKind)}:${String(commissionedBy)}:${idempotencyKey}`}))`;
    },
    findByCommissionKey: async ({ fleetId, by, idempotencyKey }) => {
      const row = await db.ship.findFirst({ where: { fleetId, ...commissionerColumns(by), commissionKey: idempotencyKey } });
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
        SELECT id, fleet_id, name, type, kind::text AS kind, scopes, note, created_at, retired_at, commissioned_by_kind::text AS commissioned_by_kind, commissioned_by, commission_key, commission_request_hash, owner_ship_id
        FROM ships
        WHERE fleet_id = ${fleetId} AND id = ${shipId}
        FOR NO KEY UPDATE`;
      return row ? toShipFromSql(row) : undefined;
    },
    listActiveOwnedByForUpdate: async (fleetId, ownerShipId) => {
      const rows = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, name, type, kind::text AS kind, scopes, note, created_at, retired_at, commissioned_by_kind::text AS commissioned_by_kind, commissioned_by, commission_key, commission_request_hash, owner_ship_id
        FROM ships
        WHERE fleet_id = ${fleetId} AND owner_ship_id = ${ownerShipId} AND retired_at IS NULL
        ORDER BY id
        FOR NO KEY UPDATE`;
      return rows.map(toShipFromSql);
    },
    listActiveHoldingInForUpdate: async (fleetId, namespace) => {
      const rows = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, name, type, kind::text AS kind, scopes, note, created_at, retired_at, commissioned_by_kind::text AS commissioned_by_kind, commissioned_by, commission_key, commission_request_hash, owner_ship_id
        FROM ships
        WHERE fleet_id = ${fleetId} AND retired_at IS NULL AND EXISTS (SELECT 1 FROM unnest(scopes) AS held(scope) WHERE starts_with(held.scope, ${`${namespace}:`}))
        ORDER BY id
        FOR NO KEY UPDATE`;
      return rows.map(toShipFromSql);
    },
    findForShare: async (fleetId, shipId) => {
      // FOR SHARE, not FOR KEY SHARE: it makes a use case that locks the ship
      // FOR NO KEY UPDATE to change it, such as a retire, wait for the send,
      // while other sends to the ship share the lock.
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, name, type, kind::text AS kind, scopes, note, created_at, retired_at, commissioned_by_kind::text AS commissioned_by_kind, commissioned_by, commission_key, commission_request_hash, owner_ship_id
        FROM ships
        WHERE fleet_id = ${fleetId} AND id = ${shipId}
        FOR SHARE`;
      return row ? toShipFromSql(row) : undefined;
    },
    findActiveByNameForShare: async (fleetId, name) => {
      // Read committed: a send that waited for a retire checks the ship again
      // once it is free, and no longer finds it by its name.
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, name, type, kind::text AS kind, scopes, note, created_at, retired_at, commissioned_by_kind::text AS commissioned_by_kind, commissioned_by, commission_key, commission_request_hash, owner_ship_id
        FROM ships
        WHERE fleet_id = ${fleetId} AND name = ${name} AND retired_at IS NULL
        FOR SHARE`;
      return row ? toShipFromSql(row) : undefined;
    },
    list: async (fleetId) => (await db.ship.findMany({ where: { fleetId }, orderBy: { id: 'asc' } })).map(toShip),
    listActive: async (fleetId) =>
      (await db.ship.findMany({ where: { fleetId, retiredAt: null, kind: { not: 'viewer' } }, orderBy: { id: 'asc' } })).map(toShip),
    listActiveOfType: async (fleetId, type) =>
      (await db.ship.findMany({ where: { fleetId, type, retiredAt: null, kind: { not: 'viewer' } }, orderBy: { id: 'asc' } })).map(toShip),
    hasActiveShipOfType: async (fleetId, type) => {
      const row = await db.ship.findFirst({ where: { fleetId, type, retiredAt: null, kind: { not: 'viewer' } }, select: { id: true } });
      return row !== null;
    },
    setScopes: async ({ fleetId, shipId, scopes }) => {
      await db.ship.update({ where: { fleetId_id: { fleetId, id: shipId } }, data: { scopes: [...scopes] } });
    },
    scopesHeldIn: async (fleetId, namespace) => {
      const rows = await db.$queryRaw<{ scope: string }[]>`
        SELECT DISTINCT held.scope FROM ships s, unnest(s.scopes) AS held(scope)
        WHERE s.fleet_id = ${fleetId} AND s.retired_at IS NULL AND starts_with(held.scope, ${`${namespace}:`})
        ORDER BY held.scope`;
      return rows.map(({ scope }) => scopeNameSchema.parse(scope));
    },
    rename: async ({ fleetId, shipId, name }) => {
      await db.ship.updateMany({ where: { fleetId, id: shipId }, data: { name } });
    },
    setOwner: async ({ fleetId, shipId, ownerShipId }) => {
      await db.ship.update({ where: { fleetId_id: { fleetId, id: shipId } }, data: { ownerShipId } });
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
    findLastSeen: async (fleetId, shipId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT COALESCE(last_seen_at, started_at) AS last_seen_at
        FROM leases
        WHERE fleet_id = ${fleetId} AND ship_id = ${shipId} AND ended_at IS NULL`;
      return row === undefined ? undefined : toLastSeen(row);
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
    findStatementForUpdate: async (fleetId, leaseId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT statement, statement_version
        FROM leases
        WHERE fleet_id = ${fleetId} AND id = ${leaseId} AND ended_at IS NULL
        FOR UPDATE`;
      return row === undefined ? undefined : { stated: toStatedStatement(row) };
    },
    saveStatement: async ({ fleetId, leaseId, stated }) => {
      await db.lease.updateMany({ where: { fleetId, id: leaseId }, data: { statement: stated.statement, statementVersion: stated.version } });
    },
    listOpenStatements: async (fleetId) => {
      const rows = await db.$queryRaw<unknown[]>`
        SELECT ship_id, statement, statement_version
        FROM leases
        WHERE fleet_id = ${fleetId} AND ended_at IS NULL`;
      return rows.map((row) => ({ shipId: toLeaseShipId(row), stated: toStatedStatement(row) }));
    },
    findTurnForUpdate: async (fleetId, leaseId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT turn::text AS turn, turn_at
        FROM leases
        WHERE fleet_id = ${fleetId} AND id = ${leaseId} AND ended_at IS NULL
        FOR UPDATE`;
      return row === undefined ? undefined : { turn: toTurn(row) };
    },
    saveTurn: async ({ fleetId, leaseId, turn }) => {
      await db.lease.updateMany({ where: { fleetId, id: leaseId }, data: { turn: turn.state, turnAt: turn.at } });
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
    markPushed: async ({ fleetId, leaseId, at, waker }) => {
      // An update before the lease is held FOR SHARE, so two marks take turns
      // on the row lock instead of each waiting for the other's share. A lease
      // already pushed matches nothing and locks nothing.
      const marked = await db.$executeRaw`
        UPDATE leases SET pushed_at = ${at}, waker = ${waker}::lease_waker
        WHERE fleet_id = ${fleetId} AND id = ${leaseId} AND ended_at IS NULL AND pushed_at IS NULL`;
      return marked > 0;
    },
    isPushed: async (fleetId, leaseId) => {
      const pushed = await db.lease.count({ where: { fleetId, id: leaseId, pushedAt: { not: null } } });
      return pushed > 0;
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
      // claim and its hand-over number are cleared: recipient and attempts stay.
      const rows = await db.$queryRaw<unknown[]>`
        WITH returned AS (
          UPDATE deliveries SET state = 'pending', claimed_by_ship_id = NULL, claimed_by_lease_id = NULL, hand_over_number = NULL
          WHERE fleet_id = ${fleetId} AND claimed_by_lease_id = ${leaseId} AND state IN ('received', 'handed')
          RETURNING id, fleet_id, message_id, recipient_ship_id, recipient_type, state::text AS state,
                    claimed_by_ship_id, claimed_by_lease_id, attempts, hand_over_number, handed_once_more_at, is_forced, created_at
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
 * delivery's state, and when a pong acknowledged it, if one did. A ping is
 * always addressed to its ship, so its message is found by the selector,
 * through the index of pings (#1027).
 */
const lastPingOfShip = Prisma.sql`
  SELECT m.created_at AS sent_at, d.state::text AS delivery_state,
         (SELECT e.occurred_at FROM events e
          WHERE e.fleet_id = d.fleet_id AND e.delivery_id = d.id
            AND e.type = 'DeliveryAcknowledged' AND e.details->>'answer' = 'pong'
          ORDER BY e.seq LIMIT 1) AS answered_at
  FROM deliveries d
  JOIN messages m ON m.fleet_id = d.fleet_id AND m.id = d.message_id
  WHERE d.fleet_id = s.fleet_id AND d.recipient_ship_id = s.id
    AND m.fleet_id = s.fleet_id AND m.selector_ship_id = s.id AND m.content_type = ${PING_CONTENT_TYPE}
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

/** A ship's crew request as one key (common/src/rules/ship-filter.ts, crewRequestKeyOf), for the ship `s` of the outer query. */
const crewRequestKeyOfShip = Prisma.sql`
  (SELECT CASE
            WHEN rq.assigned_to_ship_id IS NOT NULL THEN COALESCE(rq.status::text, 'crewing')
            WHEN EXISTS (SELECT 1 FROM leases ol
                         WHERE ol.fleet_id = s.fleet_id AND ol.ship_id = s.id AND ol.ended_at IS NULL
                           AND EXISTS (SELECT 1 FROM events e
                                       JOIN ships a ON a.fleet_id = e.fleet_id AND a.id = e.actor_ship_id
                                       WHERE e.fleet_id = s.fleet_id AND e.ship_id = s.id
                                         AND e.type = 'StartingPromptIssued' AND e.occurred_at <= ol.started_at)) THEN 'crewedByHand'
            ELSE 'needsCrew'
          END
   FROM crew_requests rq WHERE rq.fleet_id = s.fleet_id AND rq.ship_id = s.id)`;

/** What sort of agent crews the ship `s` of the outer query (common/src/rules/ship-filter.ts, agentKindOf). */
function agentKindOfShip(pluginShipIds: readonly ShipId[]): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN s.kind IN ('operator', 'viewer') THEN 'console'
      WHEN s.id = ANY(${[...pluginShipIds]}::text[]) THEN 'plugin'
      WHEN s.type = 'trierarch' THEN 'trierarch'
      ELSE COALESCE((SELECT CASE ol.harness WHEN 'claude-code' THEN 'claudeCode' WHEN 'codex' THEN 'codex' END
                     FROM leases ol WHERE ol.fleet_id = s.fleet_id AND ol.ship_id = s.id AND ol.ended_at IS NULL), 'other')
    END`;
}

/** A ship's status (domain/registry/ship.ts, shipStatus), for the ship `s` of the outer query. */
const statusOfShip = Prisma.sql`
  CASE
    WHEN s.retired_at IS NOT NULL THEN 'retired'
    WHEN s.kind IN ('operator', 'viewer')
      OR EXISTS (SELECT 1 FROM leases ol WHERE ol.fleet_id = s.fleet_id AND ol.ship_id = s.id AND ol.ended_at IS NULL) THEN 'crewed'
    ELSE 'awaitingCrew'
  END`;

/** Whether the caller reads the ship `s` of the outer query (decision 0034). */
function isInReachOfShip(reach: ReadReach): Prisma.Sql {
  return reach.kind === 'every' ? Prisma.sql`true` : Prisma.sql`s.id = ANY(${[...reach.shipIds]}::text[])`;
}

/**
 * The filter (common/src/rules/ship-filter.ts) as conditions on the ship `s`
 * of the outer query, each starting with AND: one statement selects the page
 * or counts the ships, and no ship is read only to be dropped.
 */
export function shipFilterCondition(
  { query, name, status = [], type = [], shipKind = [], crewRequest = [], assignedTo = [], needsCrew, valueIds = [], shipIds = [], kind = [], pluginShipIds = [] }: ShipFilter,
  reach: ReadReach,
): Prisma.Sql {
  const needle = query?.trim().toLowerCase() ?? '';
  const values = [...new Set(valueIds)];
  // A ship outside read reach shows its name, type and status only: what it does not show never selects it.
  const isHiddenFilterPicked = crewRequest.length > 0 || assignedTo.length > 0 || needsCrew !== undefined || kind.length > 0 || values.length > 0;
  const conditions = [
    isHiddenFilterPicked ? Prisma.sql`AND ${isInReachOfShip(reach)}` : undefined,
    needle === '' ? undefined : Prisma.sql`AND (strpos(lower(s.name), ${needle}) > 0 OR strpos(lower(s.type), ${needle}) > 0)`,
    // An active ship's name is unique: ships_fleet_id_name_active_key finds the one ship.
    name === undefined ? undefined : Prisma.sql`AND s.name = ${name}`,
    // With the retired ones asked, the name in lower case lets ships_name_listing_every_status_idx find them all.
    name === undefined || !status.includes('retired') ? undefined : Prisma.sql`AND lower(s.name) COLLATE "C" = lower(${name}) COLLATE "C"`,
    ...statusConditions(status),
    type.length === 0 ? undefined : Prisma.sql`AND s.type = ANY(${[...type]}::text[])`,
    shipKind.length === 0 ? undefined : Prisma.sql`AND s.kind = ANY(${[...shipKind]}::ship_kind[])`,
    crewRequest.length === 0 ? undefined : Prisma.sql`AND COALESCE(${crewRequestKeyOfShip}, 'none') = ANY(${[...crewRequest]}::text[])`,
    values.length === 0
      ? undefined
      : Prisma.sql`AND (SELECT count(*) FROM ship_labels sl
                        WHERE sl.fleet_id = s.fleet_id AND sl.ship_id = s.id AND sl.value_id = ANY(${values}::text[])) = ${values.length}`,
    shipIds.length === 0 ? undefined : Prisma.sql`AND s.id = ANY(${[...shipIds]}::text[])`,
    needsCrew === undefined ? undefined : needsCrewCondition(needsCrew),
    assignedTo.length === 0
      ? undefined
      : Prisma.sql`AND EXISTS (SELECT 1 FROM crew_requests acr
                               WHERE acr.fleet_id = s.fleet_id AND acr.ship_id = s.id AND acr.assigned_to_ship_id = ANY(${[...assignedTo]}::text[]))`,
    kind.length === 0 ? undefined : Prisma.sql`AND ${agentKindOfShip(pluginShipIds)} = ANY(${[...kind]}::text[])`,
  ].filter((condition) => condition !== undefined);
  return conditions.length === 0 ? Prisma.empty : Prisma.join(conditions, ' ');
}

/**
 * The ships of any status picked, written so the listing indexes serve the
 * common picks: every status needs no condition, retired alone is its
 * retirement, and a pick without retired reads only active ships, which the
 * active listing indexes hold, every active status needing nothing more.
 */
function statusConditions(status: readonly ShipStatus[]): Prisma.Sql[] {
  const isEveryActivePicked = status.includes('awaitingCrew') && status.includes('crewed');
  if (status.length === 0 || (status.includes('retired') && isEveryActivePicked)) {
    return [];
  }
  if (status.length === 1 && status[0] === 'retired') {
    return [Prisma.sql`AND s.retired_at IS NOT NULL`];
  }
  if (status.includes('retired')) {
    return [Prisma.sql`AND ${statusOfShip} = ANY(${[...status]}::text[])`];
  }
  const active = Prisma.sql`AND s.retired_at IS NULL`;
  return isEveryActivePicked ? [active] : [active, Prisma.sql`AND ${statusOfShip} = ANY(${[...status]}::text[])`];
}

/**
 * The ships on Needs crew (common/src/rules/ship-filter.ts, isNeedingCrew):
 * an unassigned request no crew by hand took, while the ship awaits crew
 * without trierarchs and while it is active with them, where also a request
 * a trierarch holds that is not running or being released.
 */
function needsCrewCondition(needsCrew: 'withTrierarchs' | 'withoutTrierarchs'): Prisma.Sql {
  if (needsCrew === 'withoutTrierarchs') {
    return Prisma.sql`AND ${statusOfShip} = 'awaitingCrew' AND ${crewRequestKeyOfShip} = 'needsCrew'`;
  }
  return Prisma.sql`AND s.retired_at IS NULL AND ${crewRequestKeyOfShip} NOT IN ('crewedByHand', 'running', 'releasing')`;
}

/** A ship's status as its sort shows it (ship-order's STATUS_WORDS), for the ship `s` of the outer query. */
const statusWordOfShip = Prisma.sql`
  CASE ${statusOfShip} WHEN 'awaitingCrew' THEN 'awaiting crew' WHEN 'crewed' THEN 'crewed' ELSE 'retired' END`;

/**
 * What the sort's column shows for the ship `s` with its open lease `l`, as
 * lower-case text, empty when the cell is (domain/registry/ship-order.ts,
 * positionOf); without a sort, nothing, as argo first and then the names
 * order the ships.
 */
function sortValueOfShip(sort: ShipSort | undefined, reach: ReadReach): Prisma.Sql {
  if (sort === undefined || COLUMNS_SHOWN_OUTSIDE_READ_REACH.includes(sort.column)) {
    return shownSortValueOfShip(sort);
  }
  // A ship outside read reach has no value in a column it does not show (decision 0034).
  return Prisma.sql`CASE WHEN ${isInReachOfShip(reach)} THEN ${shownSortValueOfShip(sort)} ELSE '' END`;
}

function shownSortValueOfShip(sort: ShipSort | undefined): Prisma.Sql {
  switch (sort?.column) {
    case undefined:
      return Prisma.sql`''::text`;
    case 'ship':
      return Prisma.sql`lower(s.name)`;
    case 'status':
      return statusWordOfShip;
    case 'report':
      return Prisma.sql`CASE WHEN s.kind IN ('agent', 'plugin') AND ${statusOfShip} = 'crewed' THEN lower(COALESCE(l.report_note, '')) ELSE '' END`;
    case 'runsOn':
      return Prisma.sql`CASE WHEN ${statusOfShip} = 'crewed' AND s.kind <> 'viewer'
                             THEN CASE WHEN s.kind = 'operator' THEN 'console' ELSE lower(COALESCE(l.harness, '')) END
                             ELSE '' END`;
    case 'requested':
      return Prisma.sql`COALESCE((SELECT to_char(rq.requested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
                                  FROM crew_requests rq WHERE rq.fleet_id = s.fleet_id AND rq.ship_id = s.id), '')`;
    case 'seen':
      return Prisma.sql`COALESCE(to_char(COALESCE(l.last_seen_at, (SELECT max(cs.last_used_at) FROM console_sessions cs
                                                                   WHERE cs.fleet_id = s.fleet_id AND cs.ship_id = s.id AND cs.lease_id IS NULL))
                                         AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), '')`;
  }
}

/** Whether the ship goes after the ones with a value: an empty cell, or, without a sort, any ship but argo. */
function sortIsEmptyOfShip(sort: ShipSort | undefined, value: Prisma.Sql): Prisma.Sql {
  return sort === undefined ? Prisma.sql`s.kind <> 'operator'` : Prisma.sql`${value} = ''`;
}

/** One term of the page's order: a column of `ranked`, in "C" collation unless it is the boolean. */
interface OrderTerm {
  column: 'sort_is_empty' | 'sort_value' | 'sort_name' | 'id';
  isDescending: boolean;
}

/**
 * The terms the page orders by, those of ship-order's comparePositions that
 * can differ: without a sort the value is always empty, and by ship it is the
 * name and never empty. So the default order and the ship sort are the keys
 * of their listing indexes.
 */
function orderTermsOf(sort: ShipSort | undefined): OrderTerm[] {
  const isDescending = isValueDescending(sort);
  if (sort === undefined) {
    return [{ column: 'sort_is_empty', isDescending: false }, { column: 'sort_name', isDescending: false }, { column: 'id', isDescending: false }];
  }
  if (sort.column === 'ship') {
    return [{ column: 'sort_value', isDescending }, { column: 'id', isDescending: false }];
  }
  return [
    { column: 'sort_is_empty', isDescending: false },
    { column: 'sort_value', isDescending },
    { column: 'sort_name', isDescending: false },
    { column: 'id', isDescending: false },
  ];
}

function termOf(alias: string, { column }: OrderTerm): Prisma.Sql {
  const term = Prisma.raw(`${alias}.${column}`);
  return column === 'sort_is_empty' ? term : Prisma.sql`${term} COLLATE "C"`;
}

function positionValueOf(position: ShipPosition, { column }: OrderTerm): Prisma.Sql {
  switch (column) {
    case 'sort_is_empty':
      return Prisma.sql`${position.isEmpty}`;
    case 'sort_value':
      return Prisma.sql`${position.value}`;
    case 'sort_name':
      return Prisma.sql`${position.name}`;
    case 'id':
      return Prisma.sql`${position.id}`;
  }
}

/**
 * The ships after the position, in the order of the terms. Terms all
 * ascending compare as one row, which a listing index seeks to; with a
 * descending first term, its bound comes first, so the index seeks to it.
 */
function afterPosition(position: ShipPosition | undefined, sort: ShipSort | undefined): Prisma.Sql {
  if (position === undefined) {
    return Prisma.empty;
  }
  const terms = orderTermsOf(sort);
  if (terms.every((term) => !term.isDescending)) {
    const ranked = Prisma.join(terms.map((term) => termOf('ranked', term)));
    const values = Prisma.join(terms.map((term) => positionValueOf(position, term)));
    return Prisma.sql`WHERE (${ranked}) > (${values})`;
  }
  const [first] = terms;
  const bound = first?.isDescending === true ? Prisma.sql`${termOf('ranked', first)} <= ${positionValueOf(position, first)} AND ` : Prisma.empty;
  return Prisma.sql`WHERE ${bound}(${beyond(terms, position)})`;
}

/** Whether a ship comes after the position by the first term that differs. */
function beyond(terms: readonly OrderTerm[], position: ShipPosition): Prisma.Sql {
  const [term, ...rest] = terms;
  if (term === undefined) {
    return Prisma.sql`false`;
  }
  const ranked = termOf('ranked', term);
  const value = positionValueOf(position, term);
  const after = term.isDescending ? Prisma.sql`${ranked} < ${value}` : Prisma.sql`${ranked} > ${value}`;
  return rest.length === 0 ? after : Prisma.sql`${after} OR (${ranked} = ${value} AND (${beyond(rest, position)}))`;
}

function orderOfPage(alias: string, sort: ShipSort | undefined): Prisma.Sql {
  const terms = orderTermsOf(sort).map((term) => Prisma.sql`${termOf(alias, term)} ${term.isDescending ? Prisma.sql`DESC` : Prisma.sql`ASC`}`);
  return Prisma.sql`ORDER BY ${Prisma.join(terms)}`;
}

/**
 * The listing's one statement: a page of the fleet's ships with what the
 * snapshot shows of each (decision 4 of the performance design). The ships
 * the filter selects are ordered by the sort's few terms alone, the page is
 * cut after the position, and only the page's ships read who crewed them,
 * their last ping and model, and their labels. One row per ship: at most one
 * lease is open and at most one secret is valid per ship (partial unique
 * indexes), so neither join multiplies rows.
 */
export function fleetListingStatement(fleetId: FleetId, { after, limit, filter, sort, reach }: ShipPage): Prisma.Sql {
  const value = sortValueOfShip(sort, reach);
  return Prisma.sql`
    SELECT s.id, s.fleet_id, s.name, s.type, s.kind::text AS kind, s.scopes, s.note, s.created_at, s.retired_at,
           s.commissioned_by_kind::text AS commissioned_by_kind, s.commissioned_by, s.commission_key, s.commission_request_hash, s.owner_ship_id,
           l.location::text AS lease_location, l.location_description AS lease_location_description,
           l.harness AS lease_harness, l.started_at AS lease_started_at, l.last_seen_at AS lease_last_seen_at,
           l.report_state::text AS report_state, l.report_note, l.reported_at, l.report_details, l.report_details_version,
           c.issued_at AS secret_issued_at, c.claimed_at AS secret_claimed_at,
           cr.settings AS crew_request_settings, cr.settings_version AS crew_request_settings_version,
           cr.requested_at AS crew_request_requested_at, cr.assigned_to_ship_id AS crew_request_assigned_to,
           cr.status::text AS crew_request_status, ca.name AS crew_request_assignee_name, cr.reason AS crew_request_reason, cr.attempt AS crew_request_attempt, cr.session_started_at AS crew_request_session_started_at, cr.is_final AS crew_request_is_final,
           cb.id AS crewed_by_id, cb.name AS crewed_by_name, o.name AS owner_name,
           p.sent_at AS ping_sent_at, p.delivery_state AS ping_delivery_state, p.answered_at AS ping_answered_at,
           lm.model AS last_model, lm.created_at AS last_model_stated_at,
           (SELECT max(cs.last_used_at) FROM console_sessions cs
             WHERE cs.fleet_id = s.fleet_id AND cs.ship_id = s.id AND cs.lease_id IS NULL) AS last_viewed_at,
           (SELECT max(el.ended_at) FROM leases el
             WHERE el.fleet_id = s.fleet_id AND el.ship_id = s.id AND el.ended_at IS NOT NULL) AS last_lease_ended_at,
           ${labelsOfShip} AS labels, ${givenBackOfShip} AS crew_request_given_back,
           pg.sort_is_empty, pg.sort_value, pg.sort_name
    FROM (
      SELECT ranked.* FROM (
        SELECT s.id, ${sortIsEmptyOfShip(sort, value)} AS sort_is_empty, ${value} AS sort_value, lower(s.name) AS sort_name
        FROM ships s
        LEFT JOIN leases l ON l.fleet_id = s.fleet_id AND l.ship_id = s.id AND l.ended_at IS NULL
        WHERE s.fleet_id = ${fleetId} ${shipFilterCondition(filter, reach)}
      ) ranked
      ${afterPosition(after, sort)}
      ${orderOfPage('ranked', sort)}
      LIMIT ${limit}
    ) pg
    JOIN ships s ON s.fleet_id = ${fleetId} AND s.id = pg.id
    LEFT JOIN leases l ON l.fleet_id = s.fleet_id AND l.ship_id = s.id AND l.ended_at IS NULL
    LEFT JOIN credentials c ON c.fleet_id = s.fleet_id AND c.ship_id = s.id AND c.invalidated_at IS NULL
    LEFT JOIN crew_requests cr ON cr.fleet_id = s.fleet_id AND cr.ship_id = s.id
    LEFT JOIN ships ca ON ca.fleet_id = cr.fleet_id AND ca.id = cr.assigned_to_ship_id
    LEFT JOIN ships o ON o.fleet_id = s.fleet_id AND o.id = s.owner_ship_id
    LEFT JOIN LATERAL (${crewedByOfShip}) cb ON true
    LEFT JOIN LATERAL (${lastPingOfShip}) p ON true
    LEFT JOIN LATERAL (${lastModelOfShip}) lm ON true
    ${orderOfPage('pg', sort)}`;
}

const shipPositionRowSchema = z.object({ id: idSchema('ship'), sort_is_empty: z.boolean(), sort_value: z.string(), sort_name: z.string() });

/** The ship's place in the page's order, as the listing statement read it. */
function shipPositionOfRow(row: unknown): ShipPosition {
  const { id, sort_is_empty, sort_value, sort_name } = shipPositionRowSchema.parse(row);
  return { isEmpty: sort_is_empty, value: sort_value, name: sort_name, id };
}

/**
 * The types of the fleet's ships in `reach` of any of the statuses, each
 * once: for active ships alone, read from the type index without a ship row.
 */
export function shipTypesStatement(fleetId: FleetId, { reach, status }: { reach: ReadReach; status: readonly ShipStatus[] }): Prisma.Sql {
  return Prisma.sql`
    SELECT DISTINCT s.type FROM ships s
    WHERE s.fleet_id = ${fleetId} AND ${isInReachOfShip(reach)} ${shipFilterCondition({ status }, reach)}`;
}

export function createPrismaFleetListing(db: Db): FleetListing {
  return {
    ships: async (fleetId, page) => {
      const rows = await db.$queryRaw<unknown[]>(fleetListingStatement(fleetId, page));
      return rows.map((row) => ({ facts: toShipFacts(row), position: shipPositionOfRow(row) }));
    },
    labels: async (fleetId) => {
      const rows = await db.$queryRaw<unknown[]>`
        SELECT ${labelColumns}, o.name AS owner_name
        FROM labels l
        LEFT JOIN ships o ON o.fleet_id = l.fleet_id AND o.id = l.owner_ship_id
        WHERE l.fleet_id = ${fleetId}
        ORDER BY l.key`;
      return rows.map(toListedLabel);
    },
    deliveryCounts: async (fleetId, shipId) => {
      const [inFlight, open] = await Promise.all([
        db.delivery.count({ where: { fleetId, claimedByShipId: shipId, state: { in: ['received', 'handed'] } } }),
        db.delivery.count({ where: { fleetId, recipientShipId: shipId, state: { in: ['pending', 'received', 'handed'] } } }),
      ]);
      return { inFlight, open };
    },
    labelShipCounts: async (fleetId, reach) => {
      // One pass over the fleet's carried values: per value its carriers, per label its distinct carriers.
      const rows = z.array(z.object({ value_id: idSchema('labelValue').nullable(), label_id: idSchema('label'), ship_count: z.number() })).parse(
        await db.$queryRaw`
          SELECT sl.value_id, sl.label_id, count(DISTINCT sl.ship_id)::int AS ship_count
          FROM ship_labels sl
          JOIN ships s ON s.fleet_id = sl.fleet_id AND s.id = sl.ship_id
          WHERE sl.fleet_id = ${fleetId} AND s.retired_at IS NULL AND ${isInReachOfShip(reach)}
          GROUP BY GROUPING SETS ((sl.label_id, sl.value_id), (sl.label_id))`,
      );
      return {
        values: new Map(rows.flatMap((row) => (row.value_id === null ? [] : [[row.value_id, row.ship_count] as const]))),
        labels: new Map(rows.flatMap((row) => (row.value_id === null ? [[row.label_id, row.ship_count] as const] : []))),
      };
    },
    counts: (fleetId, { reach, filter }) => readShipCounts(db, { fleetId, reach, selected: shipFilterCondition(filter, reach) }),
    types: async (fleetId, read) => z.array(z.object({ type: z.string() })).parse(await db.$queryRaw(shipTypesStatement(fleetId, read)))
        .map(({ type }) => type)
        .toSorted(),
    statement: async (fleetId, shipId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT statement, statement_version
        FROM leases
        WHERE fleet_id = ${fleetId} AND ship_id = ${shipId} AND ended_at IS NULL`;
      return row === undefined ? null : toStatedStatement(row);
    },
    ship: async (fleetId, shipId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT s.id, s.fleet_id, s.name, s.type, s.kind::text AS kind, s.scopes, s.note, s.created_at, s.retired_at,
               s.commissioned_by_kind::text AS commissioned_by_kind, s.commissioned_by, s.commission_key, s.commission_request_hash, s.owner_ship_id,
               l.location::text AS lease_location, l.location_description AS lease_location_description,
               l.harness AS lease_harness, l.started_at AS lease_started_at, l.last_seen_at AS lease_last_seen_at,
               l.report_state::text AS report_state, l.report_note, l.reported_at, l.report_details, l.report_details_version,
               c.issued_at AS secret_issued_at, c.claimed_at AS secret_claimed_at,
               cr.settings AS crew_request_settings, cr.settings_version AS crew_request_settings_version,
               cr.requested_at AS crew_request_requested_at, cr.assigned_to_ship_id AS crew_request_assigned_to,
               cr.status::text AS crew_request_status, ca.name AS crew_request_assignee_name, cr.reason AS crew_request_reason, cr.attempt AS crew_request_attempt, cr.session_started_at AS crew_request_session_started_at, cr.is_final AS crew_request_is_final,
               cb.id AS crewed_by_id, cb.name AS crewed_by_name, o.name AS owner_name,
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
        LEFT JOIN ships o ON o.fleet_id = s.fleet_id AND o.id = s.owner_ship_id
        LEFT JOIN LATERAL (${crewedByOfShip}) cb ON true
        LEFT JOIN LATERAL (${lastPingOfShip}) p ON true
        LEFT JOIN LATERAL (${lastModelOfShip}) lm ON true
        WHERE s.fleet_id = ${fleetId} AND s.id = ${shipId}`;
      return row === undefined ? undefined : toShipFacts(row);
    },
  };
}
