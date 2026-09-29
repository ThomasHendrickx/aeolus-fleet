import type { EventLog } from '../../core/shared/events.js';
import type { Db } from './client.js';

export function createPrismaEventLog(db: Db): EventLog {
  return {
    append: async (event) => {
      await db.event.create({
        data: {
          id: event.id,
          fleetId: event.fleetId,
          type: event.type,
          occurredAt: event.occurredAt,
          actorShipId: event.actor.kind === 'ship' ? event.actor.shipId : null,
          shipId: event.shipId ?? null,
          messageId: event.messageId ?? null,
          deliveryId: event.deliveryId ?? null,
          details: event.details,
        },
      });
    },
  };
}
