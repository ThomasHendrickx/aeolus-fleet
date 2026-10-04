import { idSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { InstallationRequest } from '../../core/registry/installation-request.js';
import type { InstallationFleetFacts, InstallationFleets, InstallationRequestRepository } from '../../core/registry/ports.js';
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
});

function toFacts(row: unknown): InstallationFleetFacts {
  const facts = factsRow.parse(row);
  return {
    ...facts,
    operatorEmail: facts.operatorEmail ?? '',
    shipCount: Number(facts.shipCount),
    messagesSince: Number(facts.messagesSince),
    storage: Number(facts.storage),
  };
}

export function createPrismaInstallationFleets(prisma: PrismaClient): InstallationFleets {
  // One fleet, or every fleet when fleetId is null, oldest first.
  const read = async (fleetId: FleetId | null, since: Date) =>
    (
      await prisma.$queryRaw<unknown[]>`
        SELECT f.id AS "fleetId", f.name, o.email AS "operatorEmail", f.created_at AS "createdAt",
          (SELECT count(*) FROM ships s WHERE s.fleet_id = f.id AND s.retired_at IS NULL) AS "shipCount",
          (SELECT count(*) FROM messages m WHERE m.fleet_id = f.id AND m.created_at >= ${since}) AS "messagesSince",
          (SELECT max(e.occurred_at) FROM events e WHERE e.fleet_id = f.id) AS "lastActivityAt",
          -- A payload's UTF-8 bytes, whatever the database encoding.
          (SELECT coalesce(sum(octet_length(convert_to(m.payload, 'UTF8'))), 0)::bigint FROM messages m WHERE m.fleet_id = f.id) AS "storage"
        FROM fleets f
        LEFT JOIN operators o ON o.fleet_id = f.id
        WHERE ${fleetId}::text IS NULL OR f.id = ${fleetId}
        ORDER BY f.created_at, f.id`
    ).map(toFacts);
  return {
    list: (since) => read(null, since),
    find: async (fleetId, since) => (await read(fleetId, since))[0],
  };
}
