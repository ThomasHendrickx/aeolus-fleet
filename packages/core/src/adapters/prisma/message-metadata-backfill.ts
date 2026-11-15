/**
 * Unreleased metadata migrations add schema only. After startup, each pass
 * fills one message-id range per fleet and commits its durable cursor with it.
 * Retrying a batch or restarting a process cannot add a count twice.
 */
import { idSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { PrismaClient } from './client.js';
import { Prisma } from './generated/client.js';
import { fillMessageQuestionIdsStatement } from './fill-message-question-ids.js';
import { unseenPlainMessagesStatement } from './unseen-plain-messages.js';

const BATCH_SIZE = 100;

/** The actual batch read, shared with the plan proof. No content filter can turn its range into a history scan. */
export function messageMetadataBatchStatement({ fleetId, after, batchSize }: { fleetId: FleetId; after: string; batchSize: number }): Prisma.Sql {
  return Prisma.sql`SELECT id FROM messages
    WHERE fleet_id = ${fleetId} AND id > ${after}
    ORDER BY id LIMIT ${batchSize}`;
}

/** Runs one bounded transaction per fleet. Returns how many messages this pass visited. */
export async function backfillMessageMetadata(prisma: PrismaClient, options: { batchSize?: number } = {}): Promise<number> {
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const fleets = await prisma.fleet.findMany({ select: { id: true } });
  let visited = 0;
  for (const fleet of fleets) {
    const fleetId = idSchema('fleet').parse(fleet.id);
    visited += await prisma.$transaction(async (db) => {
      await db.$executeRaw`INSERT INTO message_metadata_backfills (fleet_id) VALUES (${fleetId}) ON CONFLICT DO NOTHING`;
      const [progress] = z.array(z.object({ after_message_id: z.string(), is_complete: z.boolean() })).parse(
        await db.$queryRaw`SELECT after_message_id, is_complete FROM message_metadata_backfills WHERE fleet_id = ${fleetId} FOR UPDATE`,
      );
      if (!progress || progress.is_complete) {
        return 0;
      }
      const rows = z.array(z.object({ id: idSchema('message') })).parse(
        await db.$queryRaw(messageMetadataBatchStatement({ fleetId, after: progress.after_message_id, batchSize })),
      );
      const ids = rows.map((row) => row.id);
      if (ids.length > 0) {
        await db.$executeRaw(fillMessageQuestionIdsStatement({ fleetId, ids }));
        // Each exchange is visited with its newest message. Lock before recounting
        // in a fresh statement: a concurrent delivery's rollup delta lands either
        // before the recount or after it, exactly once, in the same lock order.
        await db.$queryRaw`
          SELECT ship_id FROM exchanges
          WHERE fleet_id = ${fleetId} AND newest_message_id = ANY(${ids}::text[]) AND unseen_plain_messages IS NULL
          ORDER BY ship_id, other_ship_id FOR UPDATE`;
        await db.$executeRaw`
          UPDATE exchanges e SET unseen_plain_messages = ${unseenPlainMessagesStatement(Prisma.sql`e`)}
          WHERE e.fleet_id = ${fleetId} AND e.newest_message_id = ANY(${ids}::text[]) AND e.unseen_plain_messages IS NULL`;
      }
      await db.$executeRaw`UPDATE message_metadata_backfills
        SET after_message_id = ${ids.at(-1) ?? progress.after_message_id}, is_complete = ${rows.length < batchSize}
        WHERE fleet_id = ${fleetId}`;
      return rows.length;
    });
  }
  return visited;
}
