/**
 * What the log holds of a failure. A database error's message can quote what
 * the request held (Postgres echoes values back: `invalid input syntax for
 * type integer: "..."`), and its stack opens with that message. So a database
 * error is logged by its codes only: Prisma's, Postgres's SQLSTATE and the
 * driver adapter's kind. Other failures can carry caller text too: keep only
 * a built-in error type and a known system code, never their message or stack.
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

type SafeErrorType = 'TypeError' | 'RangeError' | 'SyntaxError' | 'ReferenceError' | 'URIError' | 'EvalError' | 'AggregateError' | 'Error' | 'Unknown';

const systemCodeSchema = z.object({ code: z.enum(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE']) });

export type LoggedFailure = { database: DatabaseErrorCodes } | { reason: 'Unexpected failure'; errorType: SafeErrorType; code?: string };

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
 * A failure as the log holds it: database codes or bounded diagnostics.
 * A failure wrapping a database error, such as a tRPC error whose cause it
 * is, counts as one: it usually repeats its words.
 */
export function failureForLog(error: unknown): LoggedFailure {
  const database = databaseCodesOf(error);
  if (database !== undefined) {
    return { database };
  }
  const code = systemCodeSchema.safeParse(error).data?.code;
  return { reason: 'Unexpected failure', errorType: errorTypeOf(error), ...(code === undefined ? {} : { code }) };
}

/** Built-in types only: even an Error's name can be supplied by an adapter or caller. */
function errorTypeOf(error: unknown): SafeErrorType {
  if (error instanceof TypeError) return 'TypeError';
  if (error instanceof RangeError) return 'RangeError';
  if (error instanceof SyntaxError) return 'SyntaxError';
  if (error instanceof ReferenceError) return 'ReferenceError';
  if (error instanceof URIError) return 'URIError';
  if (error instanceof EvalError) return 'EvalError';
  if (error instanceof AggregateError) return 'AggregateError';
  return error instanceof Error ? 'Error' : 'Unknown';
}

/** A failure as one safe line for the operator's terminal, never arbitrary failure text. */
export function describeFailure(error: unknown): string {
  const failure = failureForLog(error);
  if ('reason' in failure) {
    return `${failure.reason} (${failure.errorType}${failure.code === undefined ? '' : `, ${failure.code}`}).`;
  }
  const { code, sqlState, kind } = failure.database;
  const named = [code, sqlState, kind].filter((part) => part !== undefined);
  return `The database failed (${named.length > 0 ? named.join(', ') : 'no code'}).`;
}
