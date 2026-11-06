import { PING_CONTENT_TYPE, type FleetId, type ShipId } from '@aeolus-fleet/common';

import { isInExchange } from '../../domain/messaging/exchange.js';
import type { Delivery, Message } from '../../domain/messaging/message.js';
import type { DeliveryRepository, MessageRepository } from '../../domain/messaging/ports.js';
import type { Db } from './client.js';
import { addChangedDelivery, type ExchangeRollups } from './exchange-rollups.js';
import { Prisma } from './generated/client.js';
import { payloadColumnsOf, toDeliveryFromSql, toMessage } from './rows.js';
import { plainBytesOf } from '../../domain/messaging/sealed-payload.js';
import { pageOf } from '../../domain/shared/page.js';

export interface BufferedMessageRepository extends MessageRepository {
  /** Adds the stored messages to their fleets' days. The unit of work's last step before commit, after the events are numbered. */
  flush(): Promise<void>;
}

/** A stored message as its fleet's day counts it. */
interface CountedMessage {
  fleetId: FleetId;
  /** Its UTC day, as YYYY-MM-DD. */
  day: string;
  payloadBytes: number;
}

/**
 * Messages on Postgres. Each message stored is counted on its fleet's row for
 * the UTC day it was stored (performance design, decision 1), in the same
 * transaction, as its last statements: the row lock on a busy day is then
 * held only until commit, and always after the fleet's lock for its event
 * numbers, so the two locks are taken in one order and never deadlock.
 */
export function createPrismaMessageRepository(db: Db): BufferedMessageRepository {
  const counted: CountedMessage[] = [];

  return {
    lockDailyCount: async (fleetId) => {
      // A transaction-level advisory lock on the fleet's daily message count, released at commit or rollback.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('daily-messages'), hashtext(${fleetId}))`;
    },
    countStoredOn: async (fleetId, day) => {
      const row = await db.messageDay.findUnique({ where: { fleetId_day: { fleetId, day } }, select: { messages: true } });
      return row?.messages ?? 0;
    },
    flush: async () => {
      for (const { fleetId, day, messages, payloadBytes } of countedDays(counted)) {
        await db.$executeRaw`
          INSERT INTO message_days (fleet_id, day, messages, payload_bytes)
          VALUES (${fleetId}, ${day}::date, ${messages}, ${payloadBytes})
          ON CONFLICT (fleet_id, day) DO UPDATE
          SET messages = message_days.messages + EXCLUDED.messages, payload_bytes = message_days.payload_bytes + EXCLUDED.payload_bytes`;
      }
      counted.length = 0;
    },
    create: async (message) => {
      const { selector } = message;
      await db.message.create({
        data: {
          id: message.id,
          fleetId: message.fleetId,
          senderShipId: message.senderShipId,
          selectorKind: selector.kind,
          selectorShipId: selector.kind === 'ship' ? selector.shipId : null,
          selectorType: selector.kind === 'type' ? selector.type : null,
          selectorValueIds: selector.kind === 'label' ? [...selector.valueIds] : [],
          ...payloadColumnsOf(message.payload),
          questionId: message.questionId,
          contentType: message.contentType,
          model: message.model,
          idempotencyKey: message.idempotencyKey,
          requestHash: message.requestHash,
          inReplyToMessageId: message.inReplyToMessageId,
          resendOfMessageId: message.resendOfMessageId,
          meetingId: message.meetingId,
          scheduleId: message.scheduleId,
          sendTime: message.sendTime,
          createdAt: message.createdAt,
        },
      });
      counted.push({ fleetId: message.fleetId, day: message.createdAt.toISOString().slice(0, 10), payloadBytes: plainBytesOf(message.payload) });
    },
    lockIdempotencyKey: async ({ senderShipId, idempotencyKey }) => {
      // A transaction-level advisory lock on the sender and its key, released at
      // commit or rollback. Read committed: once the holder commits, the next
      // one's lookup sees the message it stored. Ship ids are unique across
      // fleets, so the sender alone keeps fleets apart.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${senderShipId}), hashtext(${idempotencyKey}))`;
    },
    findByIdempotencyKey: async ({ fleetId, senderShipId, idempotencyKey }) => {
      const row = await db.message.findFirst({ where: { fleetId, senderShipId, idempotencyKey } });
      return row ? toMessage(row) : undefined;
    },
    find: async (fleetId, messageId) => {
      const row = await db.message.findFirst({ where: { fleetId, id: messageId } });
      return row ? toMessage(row) : undefined;
    },
  };
}

/** The counted messages summed per fleet and day, in one order, so concurrent units of work lock the rows alike. */
function countedDays(counted: readonly CountedMessage[]): { fleetId: FleetId; day: string; messages: number; payloadBytes: number }[] {
  const days = new Map<string, { fleetId: FleetId; day: string; messages: number; payloadBytes: number }>();
  for (const { fleetId, day, payloadBytes } of counted) {
    const key = `${fleetId} ${day}`;
    const sum = days.get(key) ?? { fleetId, day, messages: 0, payloadBytes: 0 };
    days.set(key, { ...sum, messages: sum.messages + 1, payloadBytes: sum.payloadBytes + payloadBytes });
  }
  return [...days.entries()].toSorted(([a], [b]) => a.localeCompare(b)).map(([, sum]) => sum);
}

/** The columns a delivery is read back with. */
const DELIVERY_COLUMNS = Prisma.sql`id, fleet_id, message_id, recipient_ship_id, recipient_type, state::text AS state,
  claimed_by_ship_id, claimed_by_lease_id, attempts, hand_over_number, handed_once_more_at, is_forced, created_at`;

/** Each delivery with its message, in the deliveries' order. */
async function withMessages(db: Db, { fleetId, deliveries }: { fleetId: FleetId; deliveries: readonly Delivery[] }): Promise<{ delivery: Delivery; message: Message }[]> {
  const messages = await db.message.findMany({ where: { fleetId, id: { in: deliveries.map((delivery) => delivery.messageId) } } });
  const byId = new Map(messages.map((row) => [row.id, toMessage(row)]));
  return deliveries.map((delivery) => {
    const message = byId.get(delivery.messageId);
    if (!message) {
      // The foreign key keeps every delivery's message in its fleet.
      throw new Error(`Delivery ${delivery.id} has no message ${delivery.messageId}`);
    }
    return { delivery, message };
  });
}

export function createPrismaDeliveryRepository(db: Db, rollups: ExchangeRollups): DeliveryRepository {
  return {
    create: async (delivery, message) => {
      const { recipient } = delivery;
      if (isInExchange(message)) {
        rollups.add(delivery.fleetId, {
          after: {
            messageId: delivery.messageId,
            senderShipId: message.senderShipId,
            reachedShipId: recipient.kind === 'ship' ? recipient.shipId : delivery.claimedByShipId,
            state: delivery.state,
          },
        });
      }
      await db.delivery.create({
        data: {
          id: delivery.id,
          fleetId: delivery.fleetId,
          messageId: delivery.messageId,
          senderShipId: message.senderShipId,
          isInExchange: isInExchange(message),
          recipientShipId: recipient.kind === 'ship' ? recipient.shipId : null,
          recipientType: recipient.kind === 'type' ? recipient.type : null,
          state: delivery.state,
          claimedByShipId: delivery.claimedByShipId,
          claimedByLeaseId: delivery.claimedByLeaseId,
          attempts: delivery.attempts,
          handOverNumber: delivery.handOverNumber,
          handedOnceMoreAt: delivery.handedOnceMoreAt,
          isForced: delivery.isForced,
          reachableShipIds: delivery.reachableShipIds ? [...delivery.reachableShipIds] : [],
          createdAt: delivery.createdAt,
        },
      });
    },
    countReceivable: async ({ fleetId, shipId, type, leaseId }) => {
      const pending = {
        state: 'pending' as const,
        OR: [{ recipientShipId: shipId }, { recipientType: type, OR: [{ reachableShipIds: { isEmpty: true } }, { reachableShipIds: { has: shipId } }] }],
      };
      const [waiting, forced] = await Promise.all([
        db.delivery.count({ where: { fleetId, OR: [{ state: { in: ['received', 'handed'] }, claimedByLeaseId: leaseId }, pending] } }),
        // Forced and not handed over yet (decision 0040): one handed is the session's to confirm.
        db.delivery.count({ where: { fleetId, isForced: true, OR: [{ state: 'received', claimedByLeaseId: leaseId }, pending] } }),
      ]);
      return { waiting, forced };
    },
    findClaimableForUpdate: async ({ fleetId, shipId, type, leaseId, limit, excluding, inReplyTo, shouldSkipHanded }) => {
      // SKIP LOCKED: a delivery another receive holds is passed over, never
      // waited for, so two receivers never get the same one (ADR 0003). The
      // limit counts the rows locked, not the rows scanned. Read committed: a
      // row another receive claimed and committed meanwhile is checked again
      // and no longer matches. One statement for the order: forced first
      // (decision 0040), then the crew's own in flight, then pending, each
      // oldest first. With inReplyTo, only deliveries of replies to that
      // message, found through the messages' (fleet_id, in_reply_to_message_id) index.
      const rows = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, message_id, recipient_ship_id, recipient_type, state::text AS state,
               claimed_by_ship_id, claimed_by_lease_id, attempts, hand_over_number, handed_once_more_at, is_forced, created_at
        FROM deliveries
        WHERE fleet_id = ${fleetId}
          AND ((state IN ('received', 'handed') AND claimed_by_lease_id = ${leaseId} AND id <> ALL(${[...excluding]}::text[]))
               OR (state = 'pending'
                   AND (recipient_ship_id = ${shipId}
                        OR (recipient_type = ${type} AND (cardinality(reachable_ship_ids) = 0 OR ${shipId} = ANY(reachable_ship_ids))))))
          AND (${shouldSkipHanded ?? false} = false OR state <> 'handed')
          AND (${inReplyTo ?? null}::text IS NULL
               OR message_id IN (SELECT id FROM messages WHERE fleet_id = ${fleetId} AND in_reply_to_message_id = ${inReplyTo ?? null}))
        ORDER BY is_forced DESC, state = 'pending', created_at, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED`;
      const deliveries = rows.map(toDeliveryFromSql);

      const messages = await db.message.findMany({
        where: { fleetId, id: { in: deliveries.map((delivery) => delivery.messageId) } },
      });
      const byId = new Map(messages.map((row) => [row.id, toMessage(row)]));
      return deliveries.map((delivery) => {
        const message = byId.get(delivery.messageId);
        if (!message) {
          // The foreign key keeps every delivery's message in its fleet.
          throw new Error(`Delivery ${delivery.id} has no message ${delivery.messageId}`);
        }
        return { delivery, message };
      });
    },
    findExchangePage: async ({ fleetId, shipId, otherShipId, toward, from, isFromIncluded, limit }) => {
      // Two halves, each read along the exchange index from the cursor and cut
      // at the page: the other ship's deliveries that reached the ship, and the
      // ship's that reached the other. A delivery is in one half only.
      const bound =
        from === undefined
          ? Prisma.empty
          : toward === 'older'
            ? isFromIncluded === true
              ? Prisma.sql`AND id <= ${from}`
              : Prisma.sql`AND id < ${from}`
            : Prisma.sql`AND id > ${from}`;
      const order = toward === 'older' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
      const half = (reachedShipId: ShipId, senderShipId: ShipId) => Prisma.sql`
        (SELECT ${DELIVERY_COLUMNS}
         FROM deliveries
         WHERE fleet_id = ${fleetId} AND is_in_exchange AND reached_ship_id = ${reachedShipId} AND sender_ship_id = ${senderShipId} ${bound}
         ORDER BY id ${order}
         LIMIT ${limit})`;
      const rows = await db.$queryRaw<unknown[]>`
        SELECT * FROM (${half(shipId, otherShipId)} UNION ALL ${half(otherShipId, shipId)}) AS exchange
        ORDER BY id ${order}
        LIMIT ${limit}`;
      const deliveries = rows.map(toDeliveryFromSql);
      const newestFirst = toward === 'older' ? deliveries : deliveries.toReversed();
      return withMessages(db, { fleetId, deliveries: newestFirst });
    },
    findRecordPage: async ({ fleetId, shipId, cursor, limit }) => {
      // Two halves, each read newest first along its own index and cut at one
      // past the page: the deliveries to the ship (fleet_id, recipient_ship_id,
      // id), and those of its type it claimed (the partial record index). A
      // delivery is in one half only, so the merged page holds no repeat.
      const after = cursor === undefined ? Prisma.empty : Prisma.sql`AND id < ${cursor}`;
      const rows = await db.$queryRaw<unknown[]>`
        SELECT * FROM (
          (SELECT id, fleet_id, message_id, recipient_ship_id, recipient_type, state::text AS state,
                  claimed_by_ship_id, claimed_by_lease_id, attempts, hand_over_number, handed_once_more_at, is_forced, created_at
           FROM deliveries
           WHERE fleet_id = ${fleetId} AND recipient_ship_id = ${shipId} ${after}
           ORDER BY id DESC
           LIMIT ${limit + 1})
          UNION ALL
          (SELECT id, fleet_id, message_id, recipient_ship_id, recipient_type, state::text AS state,
                  claimed_by_ship_id, claimed_by_lease_id, attempts, hand_over_number, handed_once_more_at, is_forced, created_at
           FROM deliveries
           WHERE fleet_id = ${fleetId} AND claimed_by_ship_id = ${shipId} AND recipient_type IS NOT NULL ${after}
           ORDER BY id DESC
           LIMIT ${limit + 1})
        ) AS record
        ORDER BY id DESC
        LIMIT ${limit + 1}`;
      const deliveries = rows.map(toDeliveryFromSql);
      const messages = await db.message.findMany({ where: { fleetId, id: { in: deliveries.map((delivery) => delivery.messageId) } } });
      const byId = new Map(messages.map((row) => [row.id, toMessage(row)]));
      const recorded = deliveries.map((delivery) => {
        const message = byId.get(delivery.messageId);
        if (!message) {
          // The foreign key keeps every delivery's message in its fleet.
          throw new Error(`Delivery ${delivery.id} has no message ${delivery.messageId}`);
        }
        return { delivery, message };
      });
      return pageOf(recorded, { limit, cursorOf: (row) => row.delivery.id });
    },
    findForUpdate: async (fleetId, deliveryId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, message_id, recipient_ship_id, recipient_type, state::text AS state,
               claimed_by_ship_id, claimed_by_lease_id, attempts, hand_over_number, handed_once_more_at, is_forced, created_at
        FROM deliveries
        WHERE fleet_id = ${fleetId} AND id = ${deliveryId}
        FOR UPDATE`;
      return row ? toDeliveryFromSql(row) : undefined;
    },
    find: async (fleetId, deliveryId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, message_id, recipient_ship_id, recipient_type, state::text AS state,
               claimed_by_ship_id, claimed_by_lease_id, attempts, hand_over_number, handed_once_more_at, is_forced, created_at
        FROM deliveries
        WHERE fleet_id = ${fleetId} AND id = ${deliveryId}`;
      return row ? toDeliveryFromSql(row) : undefined;
    },
    findOfMessageReaching: async (fleetId, { messageId, shipId }) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, message_id, recipient_ship_id, recipient_type, state::text AS state,
               claimed_by_ship_id, claimed_by_lease_id, attempts, hand_over_number, handed_once_more_at, is_forced, created_at
        FROM deliveries
        WHERE fleet_id = ${fleetId} AND message_id = ${messageId} AND (recipient_ship_id = ${shipId} OR claimed_by_ship_id = ${shipId})
        LIMIT 1`;
      return row ? toDeliveryFromSql(row) : undefined;
    },
    findOpenPing: async (fleetId, shipId) => {
      const row = await db.message.findFirst({
        where: {
          fleetId,
          contentType: PING_CONTENT_TYPE,
          deliveries: { some: { fleetId, recipientShipId: shipId, state: { in: ['pending', 'received', 'handed'] } } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return row ? toMessage(row) : undefined;
    },
    update: async (delivery) => {
      // The row as it was, locked, so the rollup learns what the change takes
      // and adds: the reached ship follows the claim (exchange-rollups.ts).
      const rows = await db.$queryRaw<unknown[]>`
        WITH before AS (
          SELECT id, state::text AS state, reached_ship_id FROM deliveries
          WHERE fleet_id = ${delivery.fleetId} AND id = ${delivery.id}
          FOR UPDATE
        )
        UPDATE deliveries d
        SET state = ${delivery.state}::delivery_state, claimed_by_ship_id = ${delivery.claimedByShipId}::text,
            claimed_by_lease_id = ${delivery.claimedByLeaseId}::text, attempts = ${delivery.attempts}::int,
            hand_over_number = ${delivery.handOverNumber}::int, handed_once_more_at = ${delivery.handedOnceMoreAt}::timestamptz
        FROM before
        WHERE d.fleet_id = ${delivery.fleetId} AND d.id = before.id
        RETURNING d.fleet_id, d.message_id, d.sender_ship_id, d.is_in_exchange, before.state AS before_state,
                  before.reached_ship_id AS before_reached_ship_id, d.state::text AS after_state, d.reached_ship_id AS after_reached_ship_id`;
      for (const row of rows) {
        addChangedDelivery(rollups, row);
      }
    },
    markRead: async ({ fleetId, deliveryId, at }) => {
      await db.delivery.updateMany({ where: { fleetId, id: deliveryId, readAt: null }, data: { readAt: at } });
    },
    markUnread: async ({ fleetId, deliveryId }) => {
      await db.delivery.updateMany({ where: { fleetId, id: deliveryId }, data: { readAt: null } });
    },
  };
}
