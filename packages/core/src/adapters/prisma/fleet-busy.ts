/**
 * A transaction that found no free connection in the pool within its wait
 * never started, so it stored nothing and the same call can simply be made
 * again. Prisma gives P2028 for it, as for an expired transaction, so the
 * message tells the two apart.
 */
import { Prisma } from './generated/client.js';

/** Prisma's code for a transaction API error. */
const TRANSACTION_API_ERROR = 'P2028';
/** What Prisma says when a transaction could not start within its wait. */
const NO_CONNECTION_IN_TIME = 'Unable to start a transaction in the given time';

/** True when the failure, or any of its causes, is a transaction that never got a connection. */
export function isFleetBusy(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === TRANSACTION_API_ERROR && error.message.includes(NO_CONNECTION_IN_TIME);
  }
  return error instanceof Error && error.cause !== undefined ? isFleetBusy(error.cause) : false;
}
