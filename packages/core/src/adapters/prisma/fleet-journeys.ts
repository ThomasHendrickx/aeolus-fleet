/** Durable compact projections and a commit-ordered installation change cursor. */
import { isDeepStrictEqual } from 'node:util';

import { fleetJourneySummarySchema, idSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { JourneyActivityExpiry } from '../../domain/shared/expire-journey-activity.js';
import { JOURNEY_ACTIVITY_DAYS, newFleetJourney, fleetJourneySummary, projectFleetJourney, type FleetJourney } from '../../domain/shared/fleet-journey.js';
import type { JourneyRecords } from '../../domain/shared/record-fleet-journey.js';
import type { FleetEvent } from '../../domain/shared/events.js';
import type { InstallationJourneyReads, JourneyPagePosition } from '../../domain/registry/read-installation-journeys.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';
import { journeySourceFacts } from './journey-source-facts.js';

const privateJourney = fleetJourneySummarySchema.omit({ activityDatesLast7Days: true, activityDatesLast28Days: true }).extend({ crewedShipIds: z.array(idSchema('ship')).max(2) });
const projectionRow = z.object({ fleetId: idSchema('fleet'), createdAt: z.date(), coverageFrom: z.date(), processedThrough: z.bigint(), data: z.unknown() });

function journeyOf(row: z.infer<typeof projectionRow>): FleetJourney {
  return row.data === null
    ? { ...newFleetJourney({ createdAt: row.createdAt.toISOString(), coverageFrom: row.coverageFrom.toISOString(), computedAt: row.coverageFrom.toISOString() }), processedThrough: Number(row.processedThrough) }
    : privateJourney.parse(row.data);
}

export function createPrismaJourneyRecords(db: Db): JourneyRecords {
  return {
    read: async (fleetId) => {
      const [row] = z.array(projectionRow).parse(await db.$queryRaw`SELECT fleet_id AS "fleetId", created_at AS "createdAt", coverage_from AS "coverageFrom", processed_through AS "processedThrough", data FROM fleet_journeys WHERE fleet_id = ${fleetId}`);
      return row ? journeyOf(row) : undefined;
    },
    save: async (fleetId, journey) => {
      const firstDate = journey.activityDates[0];
      const expiresAt = firstDate ? new Date(Date.parse(`${firstDate}T00:00:00.000Z`) + JOURNEY_ACTIVITY_DAYS * 86_400_000) : null;
      await db.$executeRaw`UPDATE fleet_journeys SET data = ${JSON.stringify(journey)}::jsonb, processed_through = ${journey.processedThrough}, activity_expires_at = ${expiresAt} WHERE fleet_id = ${fleetId}`;
    },
  };
}

/** Called after the source fleet row is locked, before commit. No background consumer can lose evidence to pruning. */
export async function projectJourneyEvents(db: Db, input: { fleetId: FleetId; events: readonly FleetEvent[]; lastSeq: number; computedAt: string }): Promise<void> {
  const { fleetId, events, lastSeq } = input;
  const created = events.find((event) => event.type === 'FleetInitialised');
  if (created) {
    await db.$executeRaw`INSERT INTO fleet_journeys(fleet_id, created_at, coverage_from) VALUES (${fleetId}, ${created.occurredAt}, ${created.occurredAt}) ON CONFLICT DO NOTHING`;
  }
  if (!events.some((event) => ['FleetInitialised', 'ShipClaimed', 'MessageAccepted', 'DeliveryReceived', 'DeliveryHanded'].includes(event.type))) {
    await db.$executeRaw`UPDATE fleet_journeys SET processed_through = ${lastSeq},
      data = data || jsonb_build_object('processedThrough', ${lastSeq}::bigint, 'computedAt', ${input.computedAt}::text)
      WHERE fleet_id = ${fleetId}`;
    return;
  }
  const [row] = z.array(projectionRow).parse(await db.$queryRaw`SELECT fleet_id AS "fleetId", created_at AS "createdAt", coverage_from AS "coverageFrom", processed_through AS "processedThrough", data FROM fleet_journeys WHERE fleet_id = ${fleetId}`);
  if (!row) return;
  const state = journeyOf(row);
  const facts = await journeySourceFacts(db, events);
  const journey = projectFleetJourney(state, { facts, computedAt: input.computedAt, processedThrough: lastSeq });
  await createPrismaJourneyRecords(db).save(fleetId, journey);
  // Watermarks stay fleet-local. The installation cursor only advertises changed facts.
  if (created || !isDeepStrictEqual(journeyFacts(state), journeyFacts(journey))) {
    await recordJourneyChange(db, { fleetId, isDeleted: false });
  }
}

function journeyFacts(journey: FleetJourney) {
  return { milestones: journey.milestones, crewedShipIds: journey.crewedShipIds,
    activityDates: journey.activityDates, latestQualifyingActivityAt: journey.latestQualifyingActivityAt };
}

/** The single installation clock is locked last. Lower cursors always commit before higher ones. */
async function recordJourneyChange(db: Db, input: { fleetId: FleetId; isDeleted: boolean }): Promise<void> {
  const [clock] = z.array(z.object({ seq: z.bigint() })).parse(await db.$queryRaw`UPDATE installation_journey_clock SET seq = seq + 1 WHERE id = 1 RETURNING seq`);
  if (!clock) throw new Error('The installation journey clock is missing');
  await db.$executeRaw`INSERT INTO installation_journey_changes(resource_id, seq, is_deleted) VALUES (${input.fleetId}, ${clock.seq}, ${input.isDeleted})
    ON CONFLICT (resource_id) DO UPDATE SET seq = EXCLUDED.seq, is_deleted = EXCLUDED.is_deleted`;
}

export async function deleteFleetJourney(db: Db, fleetId: FleetId): Promise<void> {
  await db.$executeRaw`DELETE FROM fleet_journeys WHERE fleet_id = ${fleetId}`;
  await recordJourneyChange(db, { fleetId, isDeleted: true });
}

/** Keyset reads are bounded before any projection JSON is loaded. */
export function journeyPageStatement(position?: JourneyPagePosition): Prisma.Sql {
  const after = position ? Prisma.sql`WHERE (created_at, fleet_id) > (${position.createdAt}, ${position.fleetId})` : Prisma.empty;
  return Prisma.sql`SELECT fleet_id AS "fleetId", created_at AS "createdAt", coverage_from AS "coverageFrom", processed_through AS "processedThrough", data
    FROM fleet_journeys ${after} ORDER BY created_at, fleet_id LIMIT 21`;
}

export function journeyChangesStatement(after: bigint): Prisma.Sql {
  return Prisma.sql`SELECT c.resource_id AS "fleetId", c.seq, c.is_deleted AS "isDeleted", j.created_at AS "createdAt", j.coverage_from AS "coverageFrom", j.processed_through AS "processedThrough", j.data
    FROM installation_journey_changes c LEFT JOIN fleet_journeys j ON j.fleet_id = c.resource_id
    WHERE c.seq > ${after} ORDER BY c.seq LIMIT 21`;
}

export function createPrismaInstallationJourneyReads(db: Db): InstallationJourneyReads {
  return {
    find: async (fleetId) => createPrismaJourneyRecords(db).read(fleetId),
    page: async (position) => z.array(projectionRow).parse(await db.$queryRaw(journeyPageStatement(position))).map((row) => ({ fleetId: row.fleetId, createdAt: row.createdAt, journey: journeyOf(row) })),
    changes: async (after) => {
      const rows = z.array(z.object({ fleetId: idSchema('fleet'), seq: z.bigint(), isDeleted: z.boolean(), createdAt: z.date().nullable(), coverageFrom: z.date().nullable(), processedThrough: z.bigint().nullable(), data: z.unknown() })).parse(await db.$queryRaw(journeyChangesStatement(after)));
      return rows.map((row) => ({ fleetId: row.fleetId, seq: row.seq, isDeleted: row.isDeleted,
        journey: row.isDeleted || row.createdAt === null || row.coverageFrom === null || row.processedThrough === null ? null
          : journeyOf({ ...row, createdAt: row.createdAt, coverageFrom: row.coverageFrom, processedThrough: row.processedThrough }),
      }));
    },
  };
}

/** Kept outside the legacy unbounded list: only one fleet and the new bounded resources carry journeys. */
export async function readFleetJourney(db: Db, input: { fleetId: FleetId; now: Date }) {
  const state = await createPrismaJourneyRecords(db).read(input.fleetId);
  return state ? fleetJourneySummary(state, input.now) : undefined;
}

/** Expiry reads only due compact projections, with concurrent maintenance workers skipping held rows. */
export function createPrismaJourneyActivityExpiry(db: Db): JourneyActivityExpiry {
  return {
    expired: async (now, limit) => {
      const rows = z.array(projectionRow).parse(await db.$queryRaw`SELECT fleet_id AS "fleetId", created_at AS "createdAt", coverage_from AS "coverageFrom", processed_through AS "processedThrough", data
        FROM fleet_journeys WHERE activity_expires_at <= ${now} ORDER BY activity_expires_at, fleet_id LIMIT ${limit} FOR UPDATE SKIP LOCKED`);
      return rows.map((row) => ({ fleetId: row.fleetId, journey: journeyOf(row) }));
    },
    save: async (fleetId, journey) => {
      await createPrismaJourneyRecords(db).save(fleetId, journey);
      await recordJourneyChange(db, { fleetId, isDeleted: false });
    },
  };
}
