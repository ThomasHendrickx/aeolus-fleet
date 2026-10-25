import { PING_CONTENT_TYPE, type FleetId } from '@aeolus-fleet/common';

import type { DeliveryRepository, MessageRepository } from '../../domain/messaging/ports.js';
import type { Db } from './client.js';
import { toDeliveryFromSql, toMessage } from './rows.js';

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
          payload: message.payload,
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
      counted.push({ fleetId: message.fleetId, day: message.createdAt.toISOString().slice(0, 10), payloadBytes: Buffer.byteLength(message.payload, 'utf8') });
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

export function createPrismaDeliveryRepository(db: Db): DeliveryRepository {
  return {
    create: async (delivery) => {
      const { recipient } = delivery;
      await db.delivery.create({
        data: {
          id: delivery.id,
          fleetId: delivery.fleetId,
          messageId: delivery.messageId,
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
      await db.delivery.updateMany({
        where: { fleetId: delivery.fleetId, id: delivery.id },
        data: {
          state: delivery.state,
          claimedByShipId: delivery.claimedByShipId,
          claimedByLeaseId: delivery.claimedByLeaseId,
          attempts: delivery.attempts,
          handOverNumber: delivery.handOverNumber,
          handedOnceMoreAt: delivery.handedOnceMoreAt,
        },
      });
    },
    markRead: async ({ fleetId, deliveryId, at }) => {
      await db.delivery.updateMany({ where: { fleetId, id: deliveryId, readAt: null }, data: { readAt: at } });
    },
    markUnread: async ({ fleetId, deliveryId }) => {
      await db.delivery.updateMany({ where: { fleetId, id: deliveryId }, data: { readAt: null } });
    },
  };
}
