/**
 * The ship counts per kind on Postgres (performance design, decision 2): one
 * statement that works out each ship's status and crew request stage as the
 * listing does, and counts them per kind, so no ship's row leaves the database.
 * The rules are `shipStatus`, `listedShipOf` and `isNeedingCrew`; the
 * integration test holds this statement to `shipCountsOf` over the listing.
 */
import { SHIP_KINDS, idSchema, shipKindSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { ReadReach } from '../../domain/registry/read-reach.js';
import type { ShipCounts } from '../../domain/registry/ship-counts.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';

const countsRow = z.object({
  kind: shipKindSchema,
  active: z.number(),
  crewed: z.number(),
  awaiting_crew: z.number(),
  retired: z.number(),
  needs_crew_with_trierarchs: z.number(),
  needs_crew_without_trierarchs: z.number(),
  longest_wait: z.object({ id: idSchema('ship'), name: z.string(), since: z.coerce.date() }).nullable(),
});

/** The ships `reach` reads: every one, or those it names. */
function inReach(reach: ReadReach): Prisma.Sql {
  return reach.kind === 'every' ? Prisma.sql`true` : Prisma.sql`s.id = ANY(${[...reach.shipIds]}::text[])`;
}

/** The count statement; `selected` is the fleet snapshot's filter as `AND ...` conditions over `ships s`. */
export function shipCountsStatement(fleetId: FleetId, read: { reach: ReadReach; selected: Prisma.Sql }): Prisma.Sql {
  const { reach, selected } = read;
  return Prisma.sql`
    WITH shown AS (
      SELECT s.id, s.name, s.kind::text AS kind,
        CASE WHEN s.retired_at IS NOT NULL THEN 'retired'
             WHEN l.id IS NOT NULL OR s.kind IN ('operator', 'viewer') THEN 'crewed'
             ELSE 'awaitingCrew' END AS status,
        s.created_at, l.id AS lease_id,
        cr.ship_id IS NOT NULL AS has_request, cr.assigned_to_ship_id, cr.status::text AS crew_status,
        -- Crewed by hand: the open lease's crew claimed a starting prompt issued before it started.
        CASE WHEN cr.ship_id IS NOT NULL AND cr.assigned_to_ship_id IS NULL AND l.id IS NOT NULL
             THEN EXISTS (SELECT 1 FROM events e
                          WHERE e.fleet_id = s.fleet_id AND e.ship_id = s.id AND e.type = 'StartingPromptIssued' AND e.occurred_at <= l.started_at)
             ELSE false END AS is_crewed_by_hand
      FROM ships s
      LEFT JOIN leases l ON l.fleet_id = s.fleet_id AND l.ship_id = s.id AND l.ended_at IS NULL
      LEFT JOIN crew_requests cr ON cr.fleet_id = s.fleet_id AND cr.ship_id = s.id
      WHERE s.fleet_id = ${fleetId} AND ${inReach(reach)} ${selected}
    ),
    staged AS (
      SELECT *, has_request AND assigned_to_ship_id IS NULL AND NOT is_crewed_by_hand AS is_unassigned,
        CASE WHEN status = 'awaitingCrew'
             THEN GREATEST(created_at, (SELECT max(el.ended_at) FROM leases el WHERE el.fleet_id = ${fleetId} AND el.ship_id = shown.id AND el.ended_at IS NOT NULL))
             END AS awaiting_since
      FROM shown
    )
    SELECT kind,
      count(*) FILTER (WHERE status <> 'retired')::int AS active,
      count(*) FILTER (WHERE status = 'crewed')::int AS crewed,
      count(*) FILTER (WHERE status = 'awaitingCrew')::int AS awaiting_crew,
      count(*) FILTER (WHERE status = 'retired')::int AS retired,
      count(*) FILTER (WHERE status <> 'retired' AND (is_unassigned
        OR (assigned_to_ship_id IS NOT NULL AND crew_status IS DISTINCT FROM 'running' AND crew_status IS DISTINCT FROM 'releasing')))::int AS needs_crew_with_trierarchs,
      count(*) FILTER (WHERE status = 'awaitingCrew' AND is_unassigned)::int AS needs_crew_without_trierarchs,
      (array_agg(json_build_object('id', id, 'name', name, 'since', awaiting_since) ORDER BY awaiting_since, id) FILTER (WHERE status = 'awaitingCrew'))[1] AS longest_wait
    FROM staged
    GROUP BY kind`;
}

/** The ships in `reach` that `selected` keeps, counted per kind, in the kinds' order. */
export async function readShipCounts(db: Db, read: { fleetId: FleetId; reach: ReadReach; selected: Prisma.Sql }): Promise<ShipCounts[]> {
  const rows = z.array(countsRow).parse(await db.$queryRaw(shipCountsStatement(read.fleetId, read)));
  return rows
    .toSorted((first, second) => SHIP_KINDS.indexOf(first.kind) - SHIP_KINDS.indexOf(second.kind))
    .map((row) => ({
      kind: row.kind,
      active: row.active,
      crewed: row.crewed,
      awaitingCrew: row.awaiting_crew,
      retired: row.retired,
      needsCrew: { withTrierarchs: row.needs_crew_with_trierarchs, withoutTrierarchs: row.needs_crew_without_trierarchs },
      longestWait: row.longest_wait && { id: row.longest_wait.id, name: row.longest_wait.name, awaitingCrewSince: row.longest_wait.since },
    }));
}
