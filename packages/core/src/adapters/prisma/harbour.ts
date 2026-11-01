/**
 * Harbour's read (docs/design/fleet-overview, "The read Harbour needs"): the
 * active ships in read reach, the viewer ship left out, each by id, name,
 * kind, its state and note, a page at a time in the listing's default order
 * through `ships_listing_idx`; and the numbers over the same ships. The
 * state is one CASE, held to `harbourStateOf` by harbour.integration.test.ts.
 */
import { idSchema, SHIP_KINDS, shipKindSchema, type FleetId, type ShipPosition } from '@aeolus-fleet/common';
import { HARBOUR_STATES } from '@aeolus-fleet/common/rules';
import { z } from 'zod';

import type { HarbourCounts, HarbourShip } from '../../domain/registry/harbour.js';
import type { HarbourRead } from '../../domain/registry/ports.js';
import type { ReadReach } from '../../domain/registry/read-reach.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';
import { afterPosition, isInReachOfShip, orderOfPage, shipPositionOfRow } from './registry.js';

/**
 * The state of the ship `s` of the outer query, with `l` its open lease,
 * first match wins: an open alert, awaiting crew (no open lease; argo is
 * always crewed) or a blocked report, a working report, else idle.
 */
function harbourStateOfShip(hasOpenAlert: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN ${hasOpenAlert} THEN 'alert'
      WHEN (l.id IS NULL AND s.kind <> 'operator') OR l.report_state = 'blocked' THEN 'waiting'
      WHEN l.report_state = 'working' THEN 'working'
      ELSE 'idle'
    END`;
}

/** Whether the ship `s` has an open alert, looked up for it alone through alerts_open_on_ship_idx: for a page's ships. */
const hasOpenAlertOfShip = Prisma.sql`EXISTS (SELECT 1 FROM alerts a WHERE a.fleet_id = s.fleet_id AND a.ship_id = s.id AND a.cleared_at IS NULL)`;

/** Every kind but the viewer ship, the console's own. */
const SHOWN_KINDS = SHIP_KINDS.filter((kind) => kind !== 'viewer');

/** The ships Harbour shows, as conditions on the ship `s` of the outer query: active, not the viewer ship, in reach. */
function isShownOfShip(fleetId: FleetId, reach: ReadReach): Prisma.Sql {
  // The kinds named, not "not the viewer", so ships_kind_listing_idx serves it.
  return Prisma.sql`s.fleet_id = ${fleetId} AND s.retired_at IS NULL AND s.removed_at IS NULL AND s.kind = ANY(${[...SHOWN_KINDS]}::ship_kind[]) AND ${isInReachOfShip(reach)}`;
}

/**
 * A page of Harbour's ships: ordered and cut by the default order's keys
 * alone, argo first and then by name, so the page reads only its own ships
 * from the index; then only the page's ships read their lease and alerts.
 * With ship ids, only those ships, in the same order.
 */
export function harbourPageStatement(fleetId: FleetId, read: HarbourRead): Prisma.Sql {
  const selected = 'shipIds' in read ? Prisma.sql`AND s.id = ANY(${[...read.shipIds]}::text[])` : Prisma.empty;
  const after = 'shipIds' in read ? Prisma.empty : afterPosition(read.after, undefined);
  const limit = 'shipIds' in read ? Prisma.empty : Prisma.sql`LIMIT ${read.limit}`;
  return Prisma.sql`
    SELECT s.id, s.name, s.kind::text AS kind, l.report_note, ${harbourStateOfShip(hasOpenAlertOfShip)} AS state,
           pg.sort_is_empty, pg.sort_value, pg.sort_name
    FROM (
      SELECT ranked.* FROM (
        SELECT s.id, s.kind <> 'operator' AS sort_is_empty, ''::text AS sort_value, lower(s.name) AS sort_name
        FROM ships s
        WHERE ${isShownOfShip(fleetId, read.reach)} ${selected}
      ) ranked
      ${after}
      ${orderOfPage('ranked', undefined)}
      ${limit}
    ) pg
    JOIN ships s ON s.fleet_id = ${fleetId} AND s.id = pg.id
    LEFT JOIN leases l ON l.fleet_id = s.fleet_id AND l.ship_id = s.id AND l.ended_at IS NULL
    ${orderOfPage('pg', undefined)}`;
}

/** Harbour's numbers: the ships it shows, counted per state with the same CASE, without reading a retired ship. */
export function harbourCountsStatement(fleetId: FleetId, reach: ReadReach): Prisma.Sql {
  return Prisma.sql`
    SELECT count(*)::int AS ships,
           count(*) FILTER (WHERE state = 'alert')::int AS alert,
           count(*) FILTER (WHERE state = 'waiting')::int AS waiting,
           count(*) FILTER (WHERE state = 'working')::int AS working,
           count(*) FILTER (WHERE state = 'idle')::int AS idle
    FROM (
      SELECT ${harbourStateOfShip(Prisma.sql`oa.ship_id IS NOT NULL`)} AS state
      FROM ships s
      LEFT JOIN leases l ON l.fleet_id = s.fleet_id AND l.ship_id = s.id AND l.ended_at IS NULL
      -- The fleet's open alerts read once, each ship with one at most once, not a lookup per ship and per count.
      LEFT JOIN (SELECT DISTINCT a.ship_id FROM alerts a WHERE a.fleet_id = ${fleetId} AND a.cleared_at IS NULL) oa ON oa.ship_id = s.id
      WHERE ${isShownOfShip(fleetId, reach)}
    ) shown`;
}

const harbourRowSchema = z.object({
  id: idSchema('ship'),
  name: z.string(),
  kind: shipKindSchema,
  report_note: z.string().nullable(),
  state: z.enum(HARBOUR_STATES),
});

const countsRowSchema = z.object({ ships: z.int(), alert: z.int(), waiting: z.int(), working: z.int(), idle: z.int() });

function harbourShipOfRow(row: unknown): { ship: HarbourShip; position: ShipPosition } {
  const { id, name, kind, report_note, state } = harbourRowSchema.parse(row);
  return { ship: { id, name, kind, state, note: report_note }, position: shipPositionOfRow(row) };
}

/**
 * Reads Harbour's ships, and on a page from the start its numbers, in one
 * repeatable-read transaction so the numbers count the ships the page
 * shows; inside a unit of work, in its transaction.
 */
export async function readHarbourOf(
  db: Db,
  { fleetId, read }: { fleetId: FleetId; read: HarbourRead },
): Promise<{ ships: { ship: HarbourShip; position: ShipPosition }[]; counts: HarbourCounts | null }> {
  const isFromStart = !('shipIds' in read) && read.after === undefined;
  if (!isFromStart) {
    const rows = await db.$queryRaw<unknown[]>(harbourPageStatement(fleetId, read));
    return { ships: rows.map(harbourShipOfRow), counts: null };
  }
  const readBoth = async (tx: Db): Promise<[unknown[], unknown[]]> => [
    await tx.$queryRaw<unknown[]>(harbourPageStatement(fleetId, read)),
    await tx.$queryRaw<unknown[]>(harbourCountsStatement(fleetId, read.reach)),
  ];
  const [rows, [counts]] = '$transaction' in db ? await db.$transaction(readBoth, { isolationLevel: 'RepeatableRead' }) : await readBoth(db);
  return { ships: rows.map(harbourShipOfRow), counts: countsRowSchema.parse(counts) };
}

