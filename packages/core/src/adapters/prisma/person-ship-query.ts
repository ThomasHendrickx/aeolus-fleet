/** One checked-out snapshot connection validates every row at the database boundary. */
import type { PoolClient } from 'pg';
import { z } from 'zod';

import type { Prisma } from './generated/client.js';

export type PersonShipQuery = <Row>(statement: Prisma.Sql, schema: z.ZodType<Row>) => Promise<Row[]>;

export function createPersonShipQuery(options: { connection: PoolClient; onStatement?: (statement: string) => void; onQuery?: (statement: Prisma.Sql) => void }): PersonShipQuery {
  return async (statement, schema) => {
    options.onStatement?.(statement.text);
    options.onQuery?.(statement);
    const rows: unknown = (await options.connection.query(statement.text, statement.values)).rows;
    return z.array(schema).parse(rows);
  };
}
