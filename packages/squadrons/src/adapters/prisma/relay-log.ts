import { idSchema } from '@aeolus-fleet/common';

import type { RelayLog } from '../../core/squadron/ports.js';
import type { Db } from './client.js';

export function createPrismaRelayLog(db: Db): RelayLog {
  return {
    record: async (relay) => {
      // Recording the same relay again, after a lost answer, changes nothing.
      await db.relay.upsert({ where: { fleetId_relayMessageId: { fleetId: relay.fleetId, relayMessageId: relay.relayMessageId } }, create: relay, update: {} });
    },
    find: async (fleetId, relayMessageId) => {
      const row = await db.relay.findUnique({ where: { fleetId_relayMessageId: { fleetId, relayMessageId } } });
      return row === null
        ? undefined
        : {
            fleetId: idSchema('fleet').parse(row.fleetId),
            squadronId: row.squadronId,
            relayMessageId: idSchema('message').parse(row.relayMessageId),
            memberShipId: idSchema('ship').parse(row.memberShipId),
            memberMessageId: idSchema('message').parse(row.memberMessageId),
          };
    },
  };
}
