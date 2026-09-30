/**
 * What the log holds of a failure. A database error's message can quote what
 * the request held (Postgres echoes values back: `invalid input syntax for
 * type integer: "..."`), and its stack opens with that message. So a database
 * error is logged by its codes only: Prisma's, Postgres's SQLSTATE and the
 * driver adapter's kind. Any other failure is logged whole.
 */
import pg from 'pg';
import { z } from 'zod';

import { Prisma } from './generated/client.js';

export interface DatabaseErrorCodes {
  /** Prisma's error code, such as P2002. */
  code?: string;
  /** Postgres's SQLSTATE, such as 23505. */
  sqlState?: string;
  /** The driver adapter's name for the error, such as UniqueConstraintViolation. */
  kind?: string;
}

export type LoggedFailure = { database: DatabaseErrorCodes } | { reason: string; stack: string | undefined };

/** Where Prisma keeps the driver adapter's error, whose cause holds Postgres's code. */
const prismaMetaSchema = z.object({
  driverAdapterError: z.object({
    cause: z.object({ originalCode: z.string().optional(), kind: z.string().optional() }),
  }),
});

const driverAdapterErrorSchema = z.object({
  name: z.literal('DriverAdapterError'),
  cause: z.object({ originalCode: z.string().optional(), kind: z.string().optional() }),
});

/** Only the codes that are there: an absent one is left out, not logged as undefined. */
function codes(found: DatabaseErrorCodes): DatabaseErrorCodes {
  return Object.fromEntries(Object.entries(found).filter(([, value]) => value !== undefined));
}

/** The codes of a database error, anywhere in the chain of causes; undefined when the failure is not one. */
function databaseCodesOf(error: unknown): DatabaseErrorCodes | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const cause = prismaMetaSchema.safeParse(error.meta).data?.driverAdapterError.cause;
    return codes({ code: error.code, sqlState: cause?.originalCode, kind: cause?.kind });
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return codes({ code: error.errorCode });
  }
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof Prisma.PrismaClientValidationError
  ) {
    return {};
  }
  if (error instanceof pg.DatabaseError) {
    return codes({ sqlState: error.code });
  }
  const adapterError = driverAdapterErrorSchema.safeParse(error).data;
  if (adapterError !== undefined) {
    return codes({ sqlState: adapterError.cause.originalCode, kind: adapterError.cause.kind });
  }
  return error instanceof Error && error.cause !== undefined ? databaseCodesOf(error.cause) : undefined;
}

/**
 * A failure as the log holds it: a database error by its codes, anything else
 * with its reason and stack. A failure wrapping a database error, such as a
 * tRPC error whose cause it is, counts as one: it usually repeats its words.
 */
export function failureForLog(error: unknown): LoggedFailure {
  const database = databaseCodesOf(error);
  if (database !== undefined) {
    return { database };
  }
  return error instanceof Error ? { reason: error.message, stack: error.stack } : { reason: String(error), stack: undefined };
}

/** A failure as one line for the operator's terminal: a database error by its codes, never its message. */
export function describeFailure(error: unknown): string {
  const failure = failureForLog(error);
  if ('reason' in failure) {
    return failure.reason;
  }
  const { code, sqlState, kind } = failure.database;
  const named = [code, sqlState, kind].filter((part) => part !== undefined);
  return `The database failed (${named.length > 0 ? named.join(', ') : 'no code'}).`;
}
