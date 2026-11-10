/** Fixed page shapes keep permission, literal search and cursor filtering in Postgres. */
import { PERSON_SHIP_PAGE_SIZE, type FleetId } from '@aeolus-fleet/common';

import type { DirectSendPermission, PersonShipPageRead } from '../../domain/registry/person-ship-reads.js';
import { personPermissionSql } from './person-permission.js';
import { Prisma } from './generated/client.js';

function literal(search: string): string {
  return `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function sendable(sender: DirectSendPermission | null): Prisma.Sql {
  return sender === null ? Prisma.sql`false` : Prisma.sql`COALESCE((s.id <> ${sender.shipId} AND s.kind <> 'viewer' AND ${personPermissionSql(sender.permission)}), false)`;
}

function permissionOf(read: PersonShipPageRead): Prisma.Sql {
  const { policy } = read;
  return policy.section === 'discovery' ? sendable(policy.sender)
    : Prisma.sql`${personPermissionSql(policy.reader)} AND NOT COALESCE(${sendable(policy.sender)}, false)`;
}

function candidates(fleetId: FleetId, pattern: string): Prisma.Sql {
  return Prisma.sql`WITH matching_ships AS (
    SELECT named.id FROM ships named
    WHERE named.fleet_id = ${fleetId} AND named.retired_at IS NULL AND named.removed_at IS NULL
      AND lower(named.name) LIKE lower(${pattern}) ESCAPE ${'\\'}
    UNION
    SELECT active_ship.id FROM leases described
    JOIN ships active_ship ON active_ship.fleet_id = described.fleet_id AND active_ship.id = described.ship_id
      AND active_ship.retired_at IS NULL AND active_ship.removed_at IS NULL
    WHERE described.fleet_id = ${fleetId} AND described.ended_at IS NULL
      AND lower(crew_description(described.statement)) LIKE lower(${pattern}) ESCAPE ${'\\'}
  )`;
}

export function personShipPageStatement(fleetId: FleetId, read: PersonShipPageRead): Prisma.Sql {
  const pattern = literal(read.search);
  const hasCandidates = read.shipIds === undefined && Array.from(read.search).length >= 3;
  const matched = hasCandidates ? candidates(fleetId, pattern) : Prisma.empty;
  const join = hasCandidates ? Prisma.sql`JOIN matching_ships matching ON matching.id = s.id` : Prisma.empty;
  // The lateral fence makes each refresh id a primary-key probe, even when
  // PostgreSQL would otherwise combine a whole-fleet GIN bitmap with id filters.
  const source = read.shipIds === undefined ? Prisma.sql`ships s` : Prisma.sql`
    unnest(${[...read.shipIds]}::text[]) requested(id)
    CROSS JOIN LATERAL (
      SELECT own.* FROM ships own
      WHERE own.fleet_id = ${fleetId} AND own.id = requested.id
        AND own.retired_at IS NULL AND own.removed_at IS NULL OFFSET 0
    ) s`;
  const selected = read.shipIds === undefined ? Prisma.empty : Prisma.sql`AND s.id = ANY(${[...read.shipIds]}::text[])`;
  const after = read.shipIds !== undefined || read.after === undefined ? Prisma.empty : Prisma.sql`
    AND (lower(s.name) COLLATE "C", s.id COLLATE "C") > (${read.after.name}::text COLLATE "C", ${read.after.shipId}::text COLLATE "C")`;
  const search = read.search.length === 0 ? Prisma.empty : Prisma.sql`
    AND (lower(s.name) LIKE lower(${pattern}) ESCAPE ${'\\'} OR lower(crew_description(l.statement)) LIKE lower(${pattern}) ESCAPE ${'\\'})`;
  const limit = read.shipIds === undefined ? Prisma.sql`LIMIT ${PERSON_SHIP_PAGE_SIZE + 1}` : Prisma.empty;
  return Prisma.sql`${matched}
    SELECT s.id AS "shipId", s.name, s.kind::text AS kind, crew_description(l.statement) AS description,
           lower(s.name) COLLATE "C" AS "sortName"
    FROM ${source} ${join}
    LEFT JOIN leases l ON l.fleet_id = s.fleet_id AND l.ship_id = s.id AND l.ended_at IS NULL
    WHERE s.fleet_id = ${fleetId} AND s.retired_at IS NULL AND s.removed_at IS NULL
      AND ${permissionOf(read)} ${selected} ${search} ${after}
    ORDER BY lower(s.name) COLLATE "C", s.id COLLATE "C"
    ${limit}`;
}
