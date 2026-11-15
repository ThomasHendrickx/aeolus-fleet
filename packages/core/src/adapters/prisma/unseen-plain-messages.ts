/** Counts only open deliveries in one exchange, looking up each message by key. */
import { isNoConventionContentType } from './content-type-sql.js';
import { Prisma } from './generated/client.js';

/** `exchange` is an internal SQL alias, never request input. OFFSET prevents a hash join over message history. */
export function unseenPlainMessagesStatement(exchange: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    SELECT count(*)::int
    FROM deliveries d
    JOIN LATERAL (
      SELECT m.content_type FROM messages m
      WHERE m.fleet_id = d.fleet_id AND m.id = d.message_id
      OFFSET 0
    ) m ON true
    WHERE d.fleet_id = ${exchange}.fleet_id
      AND d.reached_ship_id = ${exchange}.ship_id AND d.sender_ship_id = ${exchange}.other_ship_id
      AND d.is_in_exchange AND d.state IN ('pending', 'received', 'handed')
      AND ${isNoConventionContentType('m.content_type')}
  )`;
}
