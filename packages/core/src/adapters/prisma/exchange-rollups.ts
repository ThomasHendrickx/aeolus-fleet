/**
 * The rollup of the list of exchanges on Postgres (docs/design/exchange-read,
 * E4, E5): one row per person ship and each ship it exchanged with, holding
 * the newest message between them and how many of the other ship's
 * deliveries to it are still open. A unit of work collects what each
 * delivery it makes or changes adds (exchange.ts says what), and writes the
 * sums as its last statement before commit, in ship id order: a row's lock
 * is then held only until commit, two label sends to the same person ships
 * take the rows in one order and never deadlock, and a unit of work rolled
 * back writes nothing. Only person ships' rows are written; the others' sums
 * are dropped in the same statement.
 */
import { deliveryStateSchema, idSchema, shipKindSchema, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { z } from 'zod';

import { exchangeCountsOf, type ExchangeSide } from '../../domain/messaging/exchange.js';
import type { ExchangeList } from '../../domain/messaging/ports.js';
import { pageOf } from '../../domain/shared/page.js';
import { Prisma } from './generated/client.js';
import type { Db } from './client.js';
import { toMessage } from './rows.js';

/**
 * A delivery row a statement changed, as it returns it for the rollup: its
 * message, sender and whether it is in an exchange, and its state and
 * reached ship before and after the change.
 */
export const changedDeliveryRowSchema = z.object({
  fleet_id: idSchema('fleet'),
  message_id: idSchema('message'),
  sender_ship_id: idSchema('ship'),
  is_in_exchange: z.boolean(),
  before_state: deliveryStateSchema,
  before_reached_ship_id: idSchema('ship').nullable(),
  after_state: deliveryStateSchema,
  after_reached_ship_id: idSchema('ship').nullable(),
});

/** Adds a changed delivery row to the rollup, when it is in an exchange. */
export function addChangedDelivery(rollups: ExchangeRollups, row: unknown): void {
  const changed = changedDeliveryRowSchema.parse(row);
  if (!changed.is_in_exchange) {
    return;
  }
  const side = { messageId: changed.message_id, senderShipId: changed.sender_ship_id };
  rollups.add(changed.fleet_id, {
    before: { ...side, reachedShipId: changed.before_reached_ship_id, state: changed.before_state },
    after: { ...side, reachedShipId: changed.after_reached_ship_id, state: changed.after_state },
  });
}

export interface ExchangeRollups {
  /** Adds what a delivery's change from `before` to `after` makes of its exchange; none for one that is not in an exchange. */
  add(fleetId: FleetId, change: { before?: ExchangeSide; after?: ExchangeSide }): void;
  /** Writes the sums. The unit of work's last step before commit. */
  flush(): Promise<void>;
}

interface Sum {
  fleetId: FleetId;
  shipId: ShipId;
  otherShipId: ShipId;
  newestMessageId: MessageId;
  unacknowledged: number;
}

export function createPrismaExchangeRollups(db: Db): ExchangeRollups {
  const sums = new Map<string, Sum>();

  return {
    add: (fleetId, { before, after }) => {
      for (const count of exchangeCountsOf({ before, after })) {
        const key = `${fleetId} ${count.shipId} ${count.otherShipId}`;
        const sum = sums.get(key);
        sums.set(key, {
          fleetId,
          shipId: count.shipId,
          otherShipId: count.otherShipId,
          newestMessageId: sum && sum.newestMessageId > count.newestMessageId ? sum.newestMessageId : count.newestMessageId,
          unacknowledged: (sum?.unacknowledged ?? 0) + count.unacknowledged,
        });
      }
    },
    flush: async () => {
      if (sums.size === 0) {
        return;
      }
      const rows = [...sums.entries()].toSorted(([first], [second]) => first.localeCompare(second)).map(([, sum]) => sum);
      sums.clear();
      await db.$executeRaw`
        INSERT INTO exchanges (fleet_id, ship_id, other_ship_id, newest_message_id, unacknowledged)
        SELECT sum.fleet_id, sum.ship_id, sum.other_ship_id, sum.newest_message_id, sum.unacknowledged
        FROM unnest(
          ${rows.map((row) => row.fleetId)}::text[], ${rows.map((row) => row.shipId)}::text[], ${rows.map((row) => row.otherShipId)}::text[],
          ${rows.map((row) => row.newestMessageId)}::text[], ${rows.map((row) => row.unacknowledged)}::int[]
        ) WITH ORDINALITY AS sum(fleet_id, ship_id, other_ship_id, newest_message_id, unacknowledged, place)
        JOIN ships s ON s.fleet_id = sum.fleet_id AND s.id = sum.ship_id AND s.kind = 'person'
        ORDER BY sum.place
        ON CONFLICT (fleet_id, ship_id, other_ship_id) DO UPDATE
        SET newest_message_id = GREATEST(exchanges.newest_message_id, EXCLUDED.newest_message_id),
            unacknowledged = exchanges.unacknowledged + EXCLUDED.unacknowledged`;
    },
  };
}

const listedRows = z.array(
  z.object({
    other_ship_id: idSchema('ship'),
    name: z.string(),
    type: z.string(),
    kind: shipKindSchema,
    newest_message_id: idSchema('message'),
    unacknowledged: z.int(),
  }),
);

/** The list of exchanges read from the rollup: a page along its (fleet_id, ship_id, newest_message_id) index, each row with its other ship and newest message. */
export function createPrismaExchangeList(db: Db): ExchangeList {
  return {
    page: async ({ fleetId, shipId, cursor, limit }) => {
      const after = cursor === undefined ? Prisma.empty : Prisma.sql`AND e.newest_message_id < ${cursor}`;
      const rows = listedRows.parse(
        await db.$queryRaw`
          SELECT e.other_ship_id, s.name, s.type, s.kind::text AS kind, e.newest_message_id, e.unacknowledged
          FROM exchanges e
          JOIN ships s ON s.fleet_id = e.fleet_id AND s.id = e.other_ship_id
          WHERE e.fleet_id = ${fleetId} AND e.ship_id = ${shipId} AND s.retired_at IS NULL ${after}
          ORDER BY e.newest_message_id DESC
          LIMIT ${limit + 1}`,
      );
      const messages = await db.message.findMany({ where: { fleetId, id: { in: rows.map((row) => row.newest_message_id) } } });
      const byId = new Map(messages.map((row) => [row.id, toMessage(row)]));
      const listed = rows.map((row) => {
        const newestMessage = byId.get(row.newest_message_id);
        if (!newestMessage) {
          // The foreign key keeps every row's newest message in its fleet.
          throw new Error(`Exchange of ${shipId} and ${row.other_ship_id} has no message ${row.newest_message_id}`);
        }
        return { otherShip: { id: row.other_ship_id, name: row.name, type: row.type, kind: row.kind }, newestMessage, unacknowledged: row.unacknowledged };
      });
      return pageOf(listed, { limit, cursorOf: (row) => row.newestMessage.id });
    },
  };
}
