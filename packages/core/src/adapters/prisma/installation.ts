import { guideStepSchema, idSchema, noticeLinkSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { Notice } from '../../domain/identity/notice.js';
import type { GuideRepository, NoticeRepository } from '../../domain/identity/ports.js';
import type { InstallationRequest } from '../../domain/registry/installation-request.js';
import { appliedLimits } from '../../domain/registry/applied-limits.js';
import { NO_INSTALLATION_SETTINGS } from '../../domain/registry/limits.js';
import type { FleetLimitReads } from '../../domain/shared/read-fleet-limits.js';
import { limitSettingsOf } from './fleet-limit-settings.js';
import { createPrismaFleetRepository } from './registry.js';
import type {
  InstallationFleetFacts,
  InstallationFleets,
  InstallationFleetWindow,
  InstallationRequestRepository,
  InstallationSettingsRepository,
} from '../../domain/registry/ports.js';
import type { Db, PrismaClient } from './client.js';
import { Prisma } from './generated/client.js';

// The installation's own reads and records (docs/architecture.md,
// "Installation"): across fleets, reachable only with the installation token.

const requestRow = z.object({
  requestId: z.string(),
  kind: z.enum(['createFleet', 'deleteFleet']),
  requestHash: z.string(),
  fleetId: idSchema('fleet').nullable(),
  operatorShipId: idSchema('ship').nullable(),
  at: z.date(),
});

function toInstallationRequest(row: unknown): InstallationRequest {
  const { kind, fleetId, operatorShipId, ...common } = requestRow.parse(row);
  if (kind === 'deleteFleet') {
    return { ...common, kind };
  }
  if (fleetId === null || operatorShipId === null) {
    throw new Error(`Installation request ${common.requestId} created a fleet but names none`);
  }
  return { ...common, kind, fleetId, operatorShipId };
}

export function createPrismaInstallationRequestRepository(db: Db): InstallationRequestRepository {
  return {
    lock: async (requestId) => {
      // A transaction-level advisory lock on the request id, released at commit or rollback.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('installation-request'), hashtext(${requestId}))`;
    },
    find: async (requestId) => {
      const row = await db.installationRequest.findUnique({ where: { requestId } });
      return row ? toInstallationRequest(row) : undefined;
    },
    record: async (request) => {
      const { requestId, kind, requestHash, at } = request;
      const names = request.kind === 'createFleet' ? { fleetId: request.fleetId, operatorShipId: request.operatorShipId } : { fleetId: null, operatorShipId: null };
      await db.installationRequest.create({ data: { requestId, kind, requestHash, at, ...names } });
    },
  };
}

const factsRow = z.object({
  fleetId: idSchema('fleet'),
  name: z.string(),
  operatorEmail: z.string().nullable(),
  createdAt: z.date(),
  shipCount: z.bigint(),
  messagesSince: z.bigint(),
  lastActivityAt: z.date().nullable(),
  storage: z.bigint(),
  messagesPerUtcDay: z.array(z.object({ date: z.iso.date(), count: z.number().int() })),
  shipLimitSet: z.boolean(),
  shipLimit: z.number().int().nullable(),
  dailyMessageLimitSet: z.boolean(),
  dailyMessageLimit: z.number().int().nullable(),
  schedulesPerShipLimitSet: z.boolean(),
  schedulesPerShipLimit: z.number().int().nullable(),
  minimumScheduleIntervalSet: z.boolean(),
  minimumScheduleInterval: z.number().int().nullable(),
  oldestPendingAt: z.date().nullable(),
  oldestInFlightAt: z.date().nullable(),
  noShipCanTake: z.bigint(),
  needsAttention: z.bigint(),
  overdue: z.bigint(),
});

function toFacts(row: unknown): InstallationFleetFacts {
  const {
    shipLimitSet,
    shipLimit,
    dailyMessageLimitSet,
    dailyMessageLimit,
    schedulesPerShipLimitSet,
    schedulesPerShipLimit,
    minimumScheduleIntervalSet,
    minimumScheduleInterval,
    oldestPendingAt,
    oldestInFlightAt,
    noShipCanTake,
    needsAttention,
    overdue,
    ...facts
  } = factsRow.parse(row);
  return {
    ...facts,
    health: { oldestPendingAt, oldestInFlightAt, noShipCanTake: Number(noShipCanTake), needsAttention: Number(needsAttention), overdue: Number(overdue) },
    operatorEmail: facts.operatorEmail ?? '',
    shipCount: Number(facts.shipCount),
    messagesSince: Number(facts.messagesSince),
    storage: Number(facts.storage),
    limitSettings: limitSettingsOf({
      shipLimitSet,
      shipLimit,
      dailyMessageLimitSet,
      dailyMessageLimit,
      schedulesPerShipLimitSet,
      schedulesPerShipLimit,
      minimumScheduleIntervalSet,
      minimumScheduleInterval,
    }),
  };
}

/** The installation's statement of one fleet's facts, or every fleet's when fleetId is null, oldest first. */
export function installationFleetsStatement(fleetId: FleetId | null, window: InstallationFleetWindow): Prisma.Sql {
  return Prisma.sql`
        SELECT f.id AS "fleetId", f.name, o.email AS "operatorEmail", f.created_at AS "createdAt",
          (SELECT count(*) FROM ships s WHERE s.fleet_id = f.id AND s.retired_at IS NULL) AS "shipCount",
          -- The last 7 times 24 hours: the whole UTC days from the first one's start from the days each send counted on,
          -- and only the hours before it, the rest of the day the window starts in, from the messages.
          (SELECT coalesce(sum(md.messages), 0) FROM message_days md WHERE md.fleet_id = f.id AND md.day >= (${window.firstDay} AT TIME ZONE 'UTC')::date)
            + (SELECT count(*) FROM messages m WHERE m.fleet_id = f.id AND m.created_at >= ${window.since} AND m.created_at < ${window.firstDay}) AS "messagesSince",
          (SELECT max(e.occurred_at) FROM events e WHERE e.fleet_id = f.id) AS "lastActivityAt",
          -- Storage and the messages per UTC day from the days each send counted on (messaging.ts), not from the messages.
          (SELECT coalesce(sum(md.payload_bytes), 0)::bigint FROM message_days md WHERE md.fleet_id = f.id) AS "storage",
          -- Each UTC day's messages from the window's first day on; a day without any is left out.
          (SELECT coalesce(json_agg(json_build_object('date', to_char(md.day, 'YYYY-MM-DD'), 'count', md.messages) ORDER BY md.day), '[]'::json)
           FROM message_days md WHERE md.fleet_id = f.id AND md.day >= (${window.firstDay} AT TIME ZONE 'UTC')::date) AS "messagesPerUtcDay",
          -- Health (#304): where its deliveries wait, from their states and times only.
          (SELECT min(d.created_at) FROM deliveries d WHERE d.fleet_id = f.id AND d.state = 'pending') AS "oldestPendingAt",
          -- In flight since its state began, as the overdue clocks read it (overdue.ts).
          (SELECT min(COALESCE((
             SELECT max(e.occurred_at) FROM events e
             WHERE e.fleet_id = d.fleet_id AND e.delivery_id = d.id
               AND (e.type = 'DeliveryReturned'
                 OR (e.type = 'DeliveryReceived' AND e.details->>'again' IS DISTINCT FROM 'true')
                 OR (e.type = 'DeliveryHanded' AND e.details->>'onceMore' IS DISTINCT FROM 'true'))
           ), d.created_at))
           FROM deliveries d WHERE d.fleet_id = f.id AND d.state IN ('received', 'handed')) AS "oldestInFlightAt",
          -- Pending to a type with no active ship that may claim it (decision 0034).
          (SELECT count(*) FROM deliveries d
           WHERE d.fleet_id = f.id AND d.state = 'pending' AND d.recipient_type IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM ships s
                             WHERE s.fleet_id = d.fleet_id AND s.type = d.recipient_type AND s.retired_at IS NULL
                               AND (cardinality(d.reachable_ship_ids) = 0 OR s.id = ANY(d.reachable_ship_ids)))) AS "noShipCanTake",
          -- Not handled is execution, not delivery (decision 0042).
(SELECT count(*) FROM deliveries d WHERE d.fleet_id = f.id AND d.state = 'undeliverable') AS "needsAttention",
          -- Told on a lease that has not ended, its delivery still in the told state, held by that lease when in flight (history.ts).
          (SELECT count(*) FROM overdue_deliveries o
           JOIN leases l ON l.fleet_id = o.fleet_id AND l.id = o.lease_id AND l.ended_at IS NULL
           JOIN deliveries d ON d.fleet_id = o.fleet_id AND d.id = o.delivery_id AND d.state = o.state
           WHERE o.fleet_id = f.id AND (o.state = 'pending' OR d.claimed_by_lease_id = o.lease_id)) AS "overdue",
          f.ship_limit_set AS "shipLimitSet", f.ship_limit AS "shipLimit",
          f.daily_message_limit_set AS "dailyMessageLimitSet", f.daily_message_limit AS "dailyMessageLimit",
          f.schedules_per_ship_limit_set AS "schedulesPerShipLimitSet", f.schedules_per_ship_limit AS "schedulesPerShipLimit",
          f.minimum_schedule_interval_set AS "minimumScheduleIntervalSet", f.minimum_schedule_interval AS "minimumScheduleInterval"
        FROM fleets f
        LEFT JOIN operators o ON o.fleet_id = f.id
        WHERE ${fleetId}::text IS NULL OR f.id = ${fleetId}
        ORDER BY f.created_at, f.id`;
}

export function createPrismaInstallationFleets(prisma: PrismaClient): InstallationFleets {
  // The planner charges oldestInFlightAt an events lookup for each of the
  // hundreds of deliveries it expects in flight, which puts the statement past
  // jit_above_cost though it runs in milliseconds: on staging JIT compiling
  // took 37 ms of the read. JIT is off for this one statement.
  const read = async (fleetId: FleetId | null, window: InstallationFleetWindow) => {
    const [, rows] = await prisma.$transaction([prisma.$executeRaw`SET LOCAL jit = off`, prisma.$queryRaw<unknown[]>(installationFleetsStatement(fleetId, window))]);
    return rows.map(toFacts);
  };
  return {
    list: (window) => read(null, window),
    find: async (fleetId, window) => (await read(fleetId, window))[0],
  };
}

/** The one row of the installation's settings. */
const SETTINGS_ROW = 1;

export function createPrismaInstallationSettings(db: Db): InstallationSettingsRepository {
  return {
    read: async () => {
      const row = await db.installationSettings.findUnique({ where: { id: SETTINGS_ROW } });
      if (!row) {
        return { ...NO_INSTALLATION_SETTINGS };
      }
      const { defaultShipLimit, defaultDailyMessageLimit, defaultSchedulesPerShipLimit, defaultMinimumScheduleInterval, fleetCap } = row;
      return { defaultShipLimit, defaultDailyMessageLimit, defaultSchedulesPerShipLimit, defaultMinimumScheduleInterval, fleetCap };
    },
    write: async (settings) => {
      await db.installationSettings.upsert({ where: { id: SETTINGS_ROW }, create: { id: SETTINGS_ROW, ...settings }, update: settings });
    },
  };
}

const noticeLinksSchema = z.array(noticeLinkSchema);
const guideStepsSchema = z.array(guideStepSchema);
/** The guide's one row: the installation has one guide or none. */
const GUIDE_ROW_ID = 'guide';

/** The installation's guide (decision 0024). Replacing it is one transaction, so a reader sees the old guide or the new one. */
export function createPrismaGuideRepository(prisma: PrismaClient): GuideRepository {
  return {
    read: async () => {
      const row = await prisma.guide.findUnique({ where: { id: GUIDE_ROW_ID } });
      return row === null ? null : { audience: row.audience, steps: guideStepsSchema.parse(row.steps) };
    },
    replace: async (guide) => {
      await prisma.$transaction([
        prisma.guide.deleteMany(),
        ...(guide === null ? [] : [prisma.guide.create({ data: { id: GUIDE_ROW_ID, audience: guide.audience, steps: guide.steps.map((step) => ({ ...step })) } })]),
      ]);
    },
  };
}

/** The installation's notices, in its order. Replacing them is one transaction, so a reader sees the old list or the new one. */
export function createPrismaNoticeRepository(prisma: PrismaClient): NoticeRepository {
  return {
    read: async () =>
      (await prisma.notice.findMany({ orderBy: { position: 'asc' } })).map(
        ({ id, audience, text, links, isDismissible }): Notice => ({ id, audience, text, links: noticeLinksSchema.parse(links), isDismissible }),
      ),
    replace: async (notices) => {
      await prisma.$transaction([
        prisma.notice.deleteMany(),
        prisma.notice.createMany({
          data: notices.map(({ id, audience, text, links, isDismissible }, position) => ({ id, position, audience, text, links: [...links], isDismissible })),
        }),
      ]);
    },
  };
}

/** What a fleet's limits apply to, read outside a unit of work: the limits as a commission or send would apply them, and the counts. */
export function createPrismaFleetLimitReads(prisma: PrismaClient): FleetLimitReads {
  const limits = { fleets: createPrismaFleetRepository(prisma), installationSettings: createPrismaInstallationSettings(prisma) };
  return {
    applied: (fleetId) => appliedLimits(limits, fleetId),
    activeShips: (fleetId) => prisma.ship.count({ where: { fleetId, retiredAt: null } }),
    messagesOn: async (fleetId, day) => {
      const row = await prisma.messageDay.findUnique({ where: { fleetId_day: { fleetId, day } }, select: { messages: true } });
      return row?.messages ?? 0;
    },
  };
}
