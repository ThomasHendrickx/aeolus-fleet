import { idSchema } from '@aeolus-fleet/common';

import type { FlagshipMessageLog } from '../../core/squadron/ports.js';
import type { Db } from './client.js';

export function createPrismaFlagshipMessageLog(db: Db): FlagshipMessageLog {
  return {
    keep: async (message) => {
      // Keeping the same delivery again, after a lost answer, changes nothing.
      await db.flagshipMessage.upsert({ where: { deliveryId: message.deliveryId }, create: message, update: {} });
    },
    list: async (fleetId, squadronId) =>
      (await db.flagshipMessage.findMany({ where: { fleetId, squadronId }, orderBy: { receivedAt: 'asc' } })).map((row) => ({
        ...row,
        fleetId: idSchema('fleet').parse(row.fleetId),
        deliveryId: idSchema('delivery').parse(row.deliveryId),
        messageId: idSchema('message').parse(row.messageId),
        senderShipId: idSchema('ship').parse(row.senderShipId),
        inReplyTo: row.inReplyTo === null ? null : idSchema('message').parse(row.inReplyTo),
      })),
  };
}
