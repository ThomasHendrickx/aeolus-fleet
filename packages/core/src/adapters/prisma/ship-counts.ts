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

/**
 * The count statement; `selected` is the fleet snapshot's filter as `AND ...`
 * conditions over `ships s`. Each part is read once for all ships (the last
 * ended lease of those awaiting crew, the starting prompts of those asking),
 * not per ship, and the longest wait is one row per kind, not a sort of every
 * waiting ship: per-ship subqueries put the estimate past Postgres's JIT
 * threshold at 23,000 ships, and compiling cost more than the statement.
 * Only the active ships go through the status and crew request stages; the
 * retired ones are counted as they are, so a fleet's retired ships, which
 * only grow, cost a count and not the stages (about 60 to 27 ms at 3,000 active
 * and 20,000 retired).
 */
export function shipCountsStatement(fleetId: FleetId, read: { reach: ReadReach; selected: Prisma.Sql }): Prisma.Sql {
  const { reach, selected } = read;
  return Prisma.sql`
    WITH shown AS (
      SELECT s.id, s.name, s.kind::text AS kind, s.created_at,
        CASE WHEN l.id IS NOT NULL OR s.kind IN ('operator', 'viewer') THEN 'crewed'
             ELSE 'awaitingCrew' END AS status,
        l.id AS lease_id, l.started_at AS lease_started_at,
        cr.ship_id IS NOT NULL AS has_request, cr.assigned_to_ship_id, cr.status::text AS crew_status
      FROM ships s
      LEFT JOIN leases l ON l.fleet_id = s.fleet_id AND l.ship_id = s.id AND l.ended_at IS NULL
      LEFT JOIN crew_requests cr ON cr.fleet_id = s.fleet_id AND cr.ship_id = s.id
      WHERE s.fleet_id = ${fleetId} AND s.retired_at IS NULL AND ${inReach(reach)} ${selected}
    ),
    retired AS (
      SELECT s.kind::text AS kind, count(*)::int AS retired FROM ships s
      WHERE s.fleet_id = ${fleetId} AND s.retired_at IS NOT NULL AND ${inReach(reach)} ${selected}
      GROUP BY s.kind
    ),
    -- Crewed by hand: the open lease's crew claimed a starting prompt issued before it started.
    crewed_by_hand AS (
      SELECT DISTINCT sh.id FROM shown sh
      JOIN events e ON e.fleet_id = ${fleetId} AND e.ship_id = sh.id AND e.type = 'StartingPromptIssued' AND e.occurred_at <= sh.lease_started_at
      WHERE sh.has_request AND sh.assigned_to_ship_id IS NULL AND sh.lease_id IS NOT NULL
    ),
    last_ended AS (
      SELECT el.ship_id, max(el.ended_at) AS ended_at FROM leases el
      JOIN shown sh ON sh.id = el.ship_id AND sh.status = 'awaitingCrew'
      WHERE el.fleet_id = ${fleetId} AND el.ended_at IS NOT NULL
      GROUP BY el.ship_id
    ),
    staged AS (
      SELECT sh.*, sh.has_request AND sh.assigned_to_ship_id IS NULL AND hand.id IS NULL AS is_unassigned,
        CASE WHEN sh.status = 'awaitingCrew' THEN GREATEST(sh.created_at, ended.ended_at) END AS awaiting_since
      FROM shown sh
      LEFT JOIN crewed_by_hand hand ON hand.id = sh.id
      LEFT JOIN last_ended ended ON ended.ship_id = sh.id
    ),
    longest AS (
      SELECT DISTINCT ON (kind) kind, json_build_object('id', id, 'name', name, 'since', awaiting_since) AS longest_wait
      FROM staged WHERE status = 'awaitingCrew'
      ORDER BY kind, awaiting_since, id
    ),
    counted AS (
      SELECT kind,
        count(*)::int AS active,
        count(*) FILTER (WHERE status = 'crewed')::int AS crewed,
        count(*) FILTER (WHERE status = 'awaitingCrew')::int AS awaiting_crew,
        count(*) FILTER (WHERE is_unassigned
          OR (assigned_to_ship_id IS NOT NULL AND crew_status IS DISTINCT FROM 'running' AND crew_status IS DISTINCT FROM 'releasing'))::int AS needs_crew_with_trierarchs,
        count(*) FILTER (WHERE status = 'awaitingCrew' AND is_unassigned)::int AS needs_crew_without_trierarchs
      FROM staged
      GROUP BY kind
    )
    -- A kind with only retired ships has no active row; one with none retired, no retired row.
    SELECT COALESCE(counted.kind, retired.kind) AS kind,
      COALESCE(counted.active, 0) AS active, COALESCE(counted.crewed, 0) AS crewed, COALESCE(counted.awaiting_crew, 0) AS awaiting_crew,
      COALESCE(retired.retired, 0) AS retired,
      COALESCE(counted.needs_crew_with_trierarchs, 0) AS needs_crew_with_trierarchs, COALESCE(counted.needs_crew_without_trierarchs, 0) AS needs_crew_without_trierarchs,
      longest.longest_wait
    FROM counted
    FULL JOIN retired ON retired.kind = counted.kind
    LEFT JOIN longest ON longest.kind = COALESCE(counted.kind, retired.kind)`;
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
