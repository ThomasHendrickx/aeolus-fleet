/**
 * How far pruning went in each exchange, read on Postgres
 * (docs/design/exchange-history): one primary key lookup, the pair put in the
 * order the pruning batch writes it, least() then greatest(), so both sides of
 * an exchange find the one row.
 */
import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { PrunedExchanges } from '../../domain/messaging/ports.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';

const markRows = z.array(z.object({ prunedUpTo: z.date() }));

/** The statement that reads the mark of the two ships' exchange, by its primary key; exported so its plan can be asserted. */
export function prunedUpToStatement(fleetId: FleetId, { shipId, otherShipId }: { shipId: ShipId; otherShipId: ShipId }): Prisma.Sql {
  return Prisma.sql`
    SELECT pruned_up_to AS "prunedUpTo" FROM pruned_exchanges
    WHERE fleet_id = ${fleetId} AND ship_id = least(${shipId}::text, ${otherShipId}::text) AND other_ship_id = greatest(${shipId}::text, ${otherShipId}::text)`;
}

export function createPrismaPrunedExchanges(db: Db): PrunedExchanges {
  return {
    prunedUpTo: async (fleetId, exchange) => {
      const [row] = markRows.parse(await db.$queryRaw(prunedUpToStatement(fleetId, exchange)));
      return row?.prunedUpTo ?? null;
    },
  };
}
