import type { Scope } from '@aeolus-fleet/common';
import { initTRPC, TRPCError } from '@trpc/server';

import { hasScope, type Caller } from '../../core/shared/caller.js';
import type { DomainError, DomainErrorKind } from '../../core/shared/errors.js';
import type { Result } from '../../core/shared/result.js';
import type { Context } from './context.js';

// Never development mode, whatever NODE_ENV says: in it tRPC puts the stack
// trace into every error it answers. The server logs failures instead.
const t = initTRPC.context<Context>().create({ isDev: false });

export const router = t.router;

const ERROR_CODES: Record<DomainErrorKind, TRPCError['code']> = {
  FLEET_ALREADY_EXISTS: 'CONFLICT',
  FLEET_NOT_FOUND: 'NOT_FOUND',
  IN_REPLY_TO_NOT_FOUND: 'NOT_FOUND',
  INVALID_EMAIL: 'BAD_REQUEST',
  INVALID_FLEET_NAME: 'BAD_REQUEST',
  INVALID_IDEMPOTENCY_KEY: 'BAD_REQUEST',
  INVALID_LOCATION: 'BAD_REQUEST',
  INVALID_PASSWORD: 'BAD_REQUEST',
  INVALID_SHIP_NAME: 'BAD_REQUEST',
  INVALID_SHIP_NOTE: 'BAD_REQUEST',
  INVALID_SHIP_TYPE: 'BAD_REQUEST',
  NOT_THE_OPERATOR_SHIP: 'FORBIDDEN',
  OPERATOR_SHIP_GETS_NO_STARTING_PROMPT: 'FORBIDDEN',
  OPERATOR_SHIP_HAS_NO_SECRET: 'FORBIDDEN',
  OPERATOR_SHIP_IS_PERMANENT: 'FORBIDDEN',
  // BAD_REQUEST, as when the schema at the door refuses the same payload.
  PAYLOAD_TOO_LARGE: 'BAD_REQUEST',
  SHIP_NAME_RESERVED: 'CONFLICT',
  SHIP_NAME_TAKEN: 'CONFLICT',
  SHIP_NOT_AWAITING_CREW: 'CONFLICT',
  SHIP_NOT_FOUND: 'NOT_FOUND',
  UNRESOLVABLE_SELECTOR: 'NOT_FOUND',
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

/** A procedure that needs no caller: the base of the console procedures, and `register`, which takes the ship secret. */
export const publicProcedure = t.procedure;

/**
 * Refuses a state-changing console call from anywhere but the console's
 * origin. The session cookie is SameSite, but hosts under one domain are one
 * site, so a page on a sibling host could make the browser post with it
 * (cross-site request forgery). A browser sends Origin with every POST, so a
 * call without it is refused too.
 */
function checkConsoleOrigin(ctx: Context): void {
  if (ctx.origin !== ctx.consoleOrigin) {
    throw new TRPCError({ code: 'FORBIDDEN', message: "A console call that changes state must come from the console's origin" });
  }
}

/** A console procedure, signing in or out: it changes state, so it comes only from the console's origin. */
export const consoleProcedure = publicProcedure.use(({ ctx, next }) => {
  checkConsoleOrigin(ctx);
  return next();
});

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
 * A procedure for any caller, whatever its scopes: the base of every scoped
 * procedure, and `whoami`, which tells a caller about itself. The caller comes
 * from the server, never from the request.
 */
export const authenticatedProcedure = publicProcedure.use(async ({ ctx, type, next }) => {
  // A mutation on the console session's cookie changes state: checked before
  // the session is used, so a forged call does not even renew it. A crew token
  // wins over the cookie, and no browser sends one by itself.
  const { bearer, sessionToken } = ctx.credentials;
  if (type === 'mutation' && bearer === undefined && sessionToken !== undefined) {
    checkConsoleOrigin(ctx);
  }
  const caller = await resolveCaller(ctx);
  if (!caller) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in, or call with the crew token register gave you' });
  }
  return next({ ctx: { caller } });
});

/**
 * A procedure that needs the given scope. The caller and its scopes come from
 * the server, never from the request, and are checked before any use case runs.
 */
export function scopedProcedure(scope: Scope) {
  return authenticatedProcedure.use(({ ctx, next }) => {
    if (!hasScope(ctx.caller, scope)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `This call needs the ${scope} scope` });
    }
    return next();
  });
}
