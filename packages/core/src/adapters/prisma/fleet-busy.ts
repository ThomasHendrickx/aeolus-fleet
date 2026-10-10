/**
 * A call that found no free connection in the pool within its wait never
 * started its work, so it stored nothing and the same call can simply be made
 * again. A transaction says so through Prisma as P2028, as an expired
 * transaction does, so the message tells the two apart. A query outside a
 * transaction, such as the crew-token lookup, gets the pg pool's own error,
 * which Prisma passes on as it is.
 */
import { Prisma } from './generated/client.js';

/** Prisma's code for a transaction API error. */
const TRANSACTION_API_ERROR = 'P2028';
/** What Prisma says when a transaction could not start within its wait. */
const NO_CONNECTION_IN_TIME = 'Unable to start a transaction in the given time';
/** What the pg pool says when no connection came free within its wait. */
const POOL_WAIT_EXCEEDED = 'timeout exceeded when trying to connect';

/** True when the failure, or any of its causes, is a call that never got a connection. */
export function isFleetBusy(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === TRANSACTION_API_ERROR && error.message.includes(NO_CONNECTION_IN_TIME);
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message === POOL_WAIT_EXCEEDED || (error.cause !== undefined && isFleetBusy(error.cause));
}
