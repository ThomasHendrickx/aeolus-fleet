import type { Scope } from '@aeolus-fleet/common';
import { initTRPC, TRPCError } from '@trpc/server';

import { hasScope, type Caller } from '../../core/shared/caller.js';
import type { DomainError, DomainErrorKind } from '../../core/shared/errors.js';
import type { Result } from '../../core/shared/result.js';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create();

export const router = t.router;

const ERROR_CODES: Record<DomainErrorKind, TRPCError['code']> = {
  FLEET_ALREADY_EXISTS: 'CONFLICT',
  FLEET_NOT_FOUND: 'NOT_FOUND',
  INVALID_EMAIL: 'BAD_REQUEST',
  INVALID_FLEET_NAME: 'BAD_REQUEST',
  INVALID_LOCATION: 'BAD_REQUEST',
  INVALID_PASSWORD: 'BAD_REQUEST',
  INVALID_SHIP_NAME: 'BAD_REQUEST',
  INVALID_SHIP_NOTE: 'BAD_REQUEST',
  INVALID_SHIP_TYPE: 'BAD_REQUEST',
  NOT_THE_OPERATOR_SHIP: 'FORBIDDEN',
  OPERATOR_SHIP_GETS_NO_STARTING_PROMPT: 'FORBIDDEN',
  OPERATOR_SHIP_HAS_NO_SECRET: 'FORBIDDEN',
  OPERATOR_SHIP_IS_PERMANENT: 'FORBIDDEN',
  SHIP_NAME_RESERVED: 'CONFLICT',
  SHIP_NAME_TAKEN: 'CONFLICT',
  SHIP_NOT_AWAITING_CREW: 'CONFLICT',
  SHIP_NOT_FOUND: 'NOT_FOUND',
  WRONG_EMAIL_OR_PASSWORD: 'UNAUTHORIZED',
  WRONG_SHIP_ID_OR_SECRET: 'UNAUTHORIZED',
};

/**
 * The value of a use case's result. A refusal becomes the matching tRPC error,
 * keeping its message: the one place domain error kinds meet API errors.
 */
export function okOrThrow<T>(result: Result<T, DomainError>): T {
  if (!result.isOk) {
    throw new TRPCError({ code: ERROR_CODES[result.error.kind], message: result.error.message });
  }
  return result.value;
}

/** A procedure that needs no caller: only signing in and out. */
export const publicProcedure = t.procedure;

/**
 * Resolves the caller from the crew token or the console session. A bearer
 * crew token wins over the cookie, and a wrong one fails rather than falling
 * back. The ship secret is no bearer: it works only for `register` (ADR 0015).
 * Using a console session keeps it, and its cookie, valid for another 30 days.
 */
async function resolveCaller(ctx: Context): Promise<Caller | undefined> {
  const { bearer, sessionToken } = ctx.credentials;
  if (bearer !== undefined) {
    return ctx.useCases.authenticate.byCrewToken(bearer);
  }
  if (sessionToken !== undefined) {
    const use = await ctx.useCases.authenticate.byConsoleSession(sessionToken);
    if (use) {
      ctx.sessionCookie.set(sessionToken, use.expiresAt);
    }
    return use?.caller;
  }
  return undefined;
}

/**
 * A procedure that needs the given scope. The caller and its scopes come from
 * the server, never from the request, and are checked before any use case runs.
 */
export function scopedProcedure(scope: Scope) {
  return publicProcedure.use(async ({ ctx, next }) => {
    const caller = await resolveCaller(ctx);
    if (!caller) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in, or call with the crew token register gave you' });
    }
    if (!hasScope(caller, scope)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `This call needs the ${scope} scope` });
    }
    return next({ ctx: { caller } });
  });
}
