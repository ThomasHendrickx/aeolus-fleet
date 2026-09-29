import type { Scope } from '@aeolus-fleet/common';
import { initTRPC, TRPCError } from '@trpc/server';

import { hasScope, type Caller } from '../../core/shared/caller.js';
import { DomainError, type DomainErrorCode } from '../../core/shared/errors.js';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create();

export const router = t.router;

const ERROR_CODES: Record<DomainErrorCode, TRPCError['code']> = {
  FLEET_ALREADY_EXISTS: 'CONFLICT',
  FLEET_NOT_FOUND: 'NOT_FOUND',
  INVALID_FLEET_NAME: 'BAD_REQUEST',
  INVALID_LOCATION: 'BAD_REQUEST',
  INVALID_SECRET: 'UNAUTHORIZED',
  NOT_THE_OPERATOR_SHIP: 'FORBIDDEN',
  OPERATOR_SHIP_IS_PERMANENT: 'FORBIDDEN',
  SHIP_NAME_RESERVED: 'CONFLICT',
};

/** Turns a domain refusal into the matching tRPC error, keeping its message. */
const domainErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof DomainError) {
    const { code, message } = result.error.cause;
    throw new TRPCError({ code: ERROR_CODES[code], message, cause: result.error.cause });
  }
  return result;
});

/** A procedure that needs no caller: only signing in and out. */
export const publicProcedure = t.procedure.use(domainErrors);

/**
 * Resolves the caller from the ship secret or the console session. A bearer
 * secret wins over the cookie, and a wrong one fails rather than falling back.
 * Using a console session keeps it, and its cookie, valid for another 30 days.
 */
async function resolveCaller(ctx: Context): Promise<Caller | undefined> {
  const { bearer, sessionToken } = ctx.credentials;
  if (bearer !== undefined) {
    return ctx.useCases.authenticate.bySecret(bearer);
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
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in, or call with a valid ship secret' });
    }
    if (!hasScope(caller, scope)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `This call needs the ${scope} scope` });
    }
    return next({ ctx: { caller } });
  });
}
