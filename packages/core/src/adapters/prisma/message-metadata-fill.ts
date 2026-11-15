/**
 * The metadata fill's ports on Postgres (docs/architecture.md, Backfills): a
 * fleet's cursor in message_metadata_backfills, the next messages by id and
 * the next exchanges by key, each batch one transaction with its cursor, and
 * the two indexes the fill and the reads of its unfilled part use, built
 * after start without holding writes. A count is written only while it is
 * null, so a batch taken again adds nothing twice.
 */
import { idSchema, type FleetId, type MessageId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { ExchangeKey, MessageMetadataFill, MetadataFillIndexes } from '../../domain/messaging/ports.js';
import type { Db, PrismaClient } from './client.js';
import { askingContentTypeText } from './content-type-sql.js';
import { fillMessageQuestionIdsStatement } from './fill-message-question-ids.js';
import { Prisma } from './generated/client.js';
import { unseenPlainMessagesStatement } from './unseen-plain-messages.js';

/**
 * Built after start, not by a migration, so a migration holds start for no
 * full read of messages or deliveries. Each is left out of schema.prisma,
 * which describes what the migrations build.
 */
const FILL_INDEXES: readonly { name: string; definition: string }[] = [
  {
    // The questions a ship asked that the fill has not reached, by message id, for its open questions.
    name: 'messages_unfilled_questions_idx',
    definition: `ON messages (fleet_id, sender_ship_id, id) WHERE asked_question_id IS NULL AND payload IS NOT NULL AND ${askingContentTypeText('content_type')}`,
  },
  {
    // The open part of an exchange, which the fill and a read of an unfilled count recount.
    name: 'deliveries_open_exchange_idx',
    definition: `ON deliveries (fleet_id, reached_ship_id, sender_ship_id, id) WHERE is_in_exchange AND state IN ('pending', 'received', 'handed')`,
  },
];

/** CREATE INDEX CONCURRENTLY runs outside a transaction: on the client, never in a unit of work. */
export function createPrismaMetadataFillIndexes(prisma: PrismaClient): MetadataFillIndexes {
  return {
    build: async () => {
      for (const { name, definition } of FILL_INDEXES) {
        const [index] = z.array(z.object({ isValid: z.boolean() })).parse(
          await prisma.$queryRaw`SELECT indisvalid AS "isValid" FROM pg_index WHERE indexrelid = to_regclass(${name})`,
        );
        if (index?.isValid === true) {
          continue;
        }
        // An invalid index is one a failed build left; it is built again.
        // The names and definitions are the constants above, never outside input.
        if (index !== undefined) {
          await prisma.$executeRawUnsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
        }
        await prisma.$executeRawUnsafe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${name}" ${definition}`);
      }
    },
  };
}

const cursorRow = z.object({
  after_message_id: idSchema('message').nullable(),
  after_ship_id: idSchema('ship').nullable(),
  after_other_ship_id: idSchema('ship').nullable(),
  is_complete: z.boolean(),
});

/** The fleet's cursor, by its key, held for update. */
export function metadataFillCursorStatement(fleetId: FleetId): Prisma.Sql {
  return Prisma.sql`SELECT after_message_id, after_ship_id, after_other_ship_id, is_complete
    FROM message_metadata_backfills WHERE fleet_id = ${fleetId} FOR UPDATE`;
}

/** The next messages by id after the cursor: a range of the messages' key. */
export function metadataFillMessagesStatement({ fleetId, after, limit }: { fleetId: FleetId; after: MessageId | null; limit: number }): Prisma.Sql {
  const from = after === null ? Prisma.empty : Prisma.sql`AND id > ${after}`;
  return Prisma.sql`SELECT id FROM messages WHERE fleet_id = ${fleetId} ${from} ORDER BY id LIMIT ${limit}`;
}

/**
 * The next exchanges by key after the cursor, a range of the exchanges' key,
 * locked in key order before their recount in a later statement: a delivery's
 * delta that commits first is in the recount, one that commits after lands
 * on the count, once either way.
 */
export function metadataFillExchangesStatement({ fleetId, after, limit }: { fleetId: FleetId; after: ExchangeKey | null; limit: number }): Prisma.Sql {
  const from = after === null ? Prisma.empty : Prisma.sql`AND (fleet_id, ship_id, other_ship_id) > (${fleetId}, ${after.shipId}, ${after.otherShipId})`;
  return Prisma.sql`SELECT ship_id, other_ship_id FROM exchanges
    WHERE fleet_id = ${fleetId} ${from}
    ORDER BY fleet_id, ship_id, other_ship_id LIMIT ${limit} FOR UPDATE`;
}

/** Counts the exchanges of the batch, the key range after `after` up to `last`, that hold no count yet. */
export function fillUnseenPlainMessagesStatement({ fleetId, after, last }: { fleetId: FleetId; after: ExchangeKey | null; last: ExchangeKey }): Prisma.Sql {
  const from = after === null ? Prisma.empty : Prisma.sql`AND (e.fleet_id, e.ship_id, e.other_ship_id) > (${fleetId}, ${after.shipId}, ${after.otherShipId})`;
  return Prisma.sql`UPDATE exchanges e SET unseen_plain_messages = ${unseenPlainMessagesStatement(Prisma.sql`e`)}
    WHERE e.fleet_id = ${fleetId} ${from}
      AND (e.fleet_id, e.ship_id, e.other_ship_id) <= (${fleetId}, ${last.shipId}, ${last.otherShipId})
      AND e.unseen_plain_messages IS NULL`;
}

export function createPrismaMessageMetadataFill(db: Db): MessageMetadataFill {
  return {
    lockCursor: async (fleetId) => {
      await db.$executeRaw`INSERT INTO message_metadata_backfills (fleet_id) VALUES (${fleetId}) ON CONFLICT DO NOTHING`;
      const [row] = z.array(cursorRow).parse(await db.$queryRaw(metadataFillCursorStatement(fleetId)));
      if (row === undefined) {
        return { afterMessageId: null, afterExchange: null, isComplete: false };
      }
      return {
        afterMessageId: row.after_message_id,
        afterExchange: row.after_ship_id === null || row.after_other_ship_id === null ? null : { shipId: row.after_ship_id, otherShipId: row.after_other_ship_id },
        isComplete: row.is_complete,
      };
    },
    fillQuestionIds: async (fleetId, query) => {
      const ids = z.array(z.object({ id: idSchema('message') })).parse(await db.$queryRaw(metadataFillMessagesStatement({ fleetId, ...query }))).map((row) => row.id);
      if (ids.length > 0) {
        await db.$executeRaw(fillMessageQuestionIdsStatement({ fleetId, ids }));
      }
      return ids;
    },
    fillUnseenPlainMessages: async (fleetId, query) => {
      const keys = z
        .array(z.object({ ship_id: idSchema('ship'), other_ship_id: idSchema('ship') }))
        .parse(await db.$queryRaw(metadataFillExchangesStatement({ fleetId, ...query })))
        .map((row): ExchangeKey => ({ shipId: row.ship_id, otherShipId: row.other_ship_id }));
      const last = keys.at(-1);
      if (last !== undefined) {
        await db.$executeRaw(fillUnseenPlainMessagesStatement({ fleetId, after: query.after, last }));
      }
      return keys;
    },
    saveCursor: async (fleetId, { afterMessageId, afterExchange, isComplete }) => {
      await db.$executeRaw`UPDATE message_metadata_backfills
        SET after_message_id = ${afterMessageId}, after_ship_id = ${afterExchange?.shipId ?? null},
            after_other_ship_id = ${afterExchange?.otherShipId ?? null}, is_complete = ${isComplete}
        WHERE fleet_id = ${fleetId}`;
    },
  };
}
