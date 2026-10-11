/**
 * A call the database was too busy for stored nothing, so the same call can
 * simply be made again. The database is too busy when:
 * - no free connection in the pool came within the call's wait. A
 *   transaction says so through Prisma as P2028; a query outside one, such as
 *   the crew-token lookup, gets the pg pool's own error, which Prisma passes
 *   on as it is;
 * - a new connection was not made within that wait, which the pg pool also
 *   says in its own words;
 * - Postgres refused a new connection because it holds too many (53300);
 * - a transaction ran past its time, so Prisma rolled it back (P2028 too).
 * P2028 is any transaction API error, so its message tells these apart from
 * the others it covers.
 */
import { z } from 'zod';

import { Prisma } from './generated/client.js';

/** Prisma's code for a transaction API error. */
const TRANSACTION_API_ERROR = 'P2028';
/** What Prisma says when a transaction could not start within its wait. */
const NO_CONNECTION_IN_TIME = 'Unable to start a transaction in the given time';
/** What Prisma says when a transaction ran past its time and was rolled back. */
const TRANSACTION_EXPIRED = 'cannot be executed on an expired transaction';
/** What the pg pool says when no connection came free within its wait. */
const POOL_WAIT_EXCEEDED = 'timeout exceeded when trying to connect';
/** What the pg pool says when a new connection was not made within its wait. */
const CONNECTING_TIMED_OUT = 'Connection terminated due to connection timeout';
/** Postgres's SQLSTATE when it holds too many connections to take another. */
const TOO_MANY_CONNECTIONS = '53300';

/** Where Prisma keeps the driver adapter's error, whose cause holds Postgres's code. */
const prismaMetaSchema = z.object({
  driverAdapterError: z.object({ cause: z.object({ originalCode: z.string().optional() }) }),
});

/** True when the failure, or any of its causes, is a call the database was too busy for. */
export function isFleetBusy(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === TRANSACTION_API_ERROR) {
      return error.message.includes(NO_CONNECTION_IN_TIME) || error.message.includes(TRANSACTION_EXPIRED);
    }
    return prismaMetaSchema.safeParse(error.meta).data?.driverAdapterError.cause.originalCode === TOO_MANY_CONNECTIONS;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message === POOL_WAIT_EXCEEDED ||
    error.message === CONNECTING_TIMED_OUT ||
    (error.cause !== undefined && isFleetBusy(error.cause))
  );
}
