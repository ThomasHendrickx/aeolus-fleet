import { idSchema, noticeLinkSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { Notice } from '../../core/identity/notice.js';
import type { NoticeRepository } from '../../core/identity/ports.js';
import type { InstallationRequest } from '../../core/registry/installation-request.js';
import { appliedLimits } from '../../core/registry/applied-limits.js';
import { NO_INSTALLATION_SETTINGS } from '../../core/registry/limits.js';
import type { FleetLimitReads } from '../../core/shared/read-fleet-limits.js';
import { createPrismaFleetRepository } from './registry.js';
import type {
  InstallationFleetFacts,
  InstallationFleets,
  InstallationFleetWindow,
  InstallationRequestRepository,
  InstallationSettingsRepository,
} from '../../core/registry/ports.js';
import type { Db, PrismaClient } from './client.js';

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
});

function toFacts(row: unknown): InstallationFleetFacts {
  const { shipLimitSet, shipLimit, dailyMessageLimitSet, dailyMessageLimit, ...facts } = factsRow.parse(row);
  return {
    ...facts,
    operatorEmail: facts.operatorEmail ?? '',
    shipCount: Number(facts.shipCount),
    messagesSince: Number(facts.messagesSince),
    storage: Number(facts.storage),
    limitSettings: {
      ships: shipLimitSet ? { kind: 'fleet', limit: shipLimit } : { kind: 'default' },
      dailyMessages: dailyMessageLimitSet ? { kind: 'fleet', limit: dailyMessageLimit } : { kind: 'default' },
    },
  };
}

export function createPrismaInstallationFleets(prisma: PrismaClient): InstallationFleets {
  // One fleet, or every fleet when fleetId is null, oldest first.
  const read = async (fleetId: FleetId | null, window: InstallationFleetWindow) =>
    (
      await prisma.$queryRaw<unknown[]>`
        SELECT f.id AS "fleetId", f.name, o.email AS "operatorEmail", f.created_at AS "createdAt",
          (SELECT count(*) FROM ships s WHERE s.fleet_id = f.id AND s.retired_at IS NULL) AS "shipCount",
          (SELECT count(*) FROM messages m WHERE m.fleet_id = f.id AND m.created_at >= ${window.since}) AS "messagesSince",
          (SELECT max(e.occurred_at) FROM events e WHERE e.fleet_id = f.id) AS "lastActivityAt",
          -- A payload's UTF-8 bytes, whatever the database encoding.
          (SELECT coalesce(sum(octet_length(convert_to(m.payload, 'UTF8'))), 0)::bigint FROM messages m WHERE m.fleet_id = f.id) AS "storage",
          -- Each UTC day's messages from the window's first day on; a day without any is left out.
          (SELECT coalesce(json_agg(json_build_object('date', d.day, 'count', d.count) ORDER BY d.day), '[]'::json)
           FROM (SELECT to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS count
                 FROM messages m WHERE m.fleet_id = f.id AND m.created_at >= ${window.firstDay} GROUP BY 1) d) AS "messagesPerUtcDay",
          f.ship_limit_set AS "shipLimitSet", f.ship_limit AS "shipLimit",
          f.daily_message_limit_set AS "dailyMessageLimitSet", f.daily_message_limit AS "dailyMessageLimit"
        FROM fleets f
        LEFT JOIN operators o ON o.fleet_id = f.id
        WHERE ${fleetId}::text IS NULL OR f.id = ${fleetId}
        ORDER BY f.created_at, f.id`
    ).map(toFacts);
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
      const { defaultShipLimit, defaultDailyMessageLimit, fleetCap } = row;
      return { defaultShipLimit, defaultDailyMessageLimit, fleetCap };
    },
    write: async (settings) => {
      await db.installationSettings.upsert({ where: { id: SETTINGS_ROW }, create: { id: SETTINGS_ROW, ...settings }, update: settings });
    },
  };
}

const noticeLinksSchema = z.array(noticeLinkSchema);

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
    messagesSince: (fleetId, since) => prisma.message.count({ where: { fleetId, createdAt: { gte: since } } }),
  };
}
