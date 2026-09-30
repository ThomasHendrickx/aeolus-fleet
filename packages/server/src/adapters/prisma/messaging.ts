import type { DeliveryRepository, MessageRepository } from '../../core/messaging/ports.js';
import type { Db } from './client.js';
import { toMessage } from './rows.js';

export function createPrismaMessageRepository(db: Db): MessageRepository {
  return {
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
          payload: message.payload,
          contentType: message.contentType,
          idempotencyKey: message.idempotencyKey,
          inReplyToMessageId: message.inReplyToMessageId,
          createdAt: message.createdAt,
        },
      });
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
          attempts: delivery.attempts,
          createdAt: delivery.createdAt,
        },
      });
    },
  };
}
