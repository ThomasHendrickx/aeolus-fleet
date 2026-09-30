import type { Scope } from '@aeolus-fleet/common';
import { initTRPC, TRPCError } from '@trpc/server';

import { hasScope, type Caller } from '../../core/shared/caller.js';
import type { DomainError, DomainErrorKind } from '../../core/shared/errors.js';
import type { Result } from '../../core/shared/result.js';
import type { Context } from './context.js';

/** All a caller learns of a server failure, with the request's id; the log keeps the rest under that id. */
const INTERNAL_ERROR_MESSAGE = 'Internal error';

// Never development mode, whatever NODE_ENV says: in it tRPC puts the stack
// trace into every error it answers. A server failure answers only that it
// failed and the request's id; a refusal keeps its own code and message.
const t = initTRPC.context<Context>().create({
  isDev: false,
  errorFormatter: ({ shape, error, ctx }) =>
    error.code === 'INTERNAL_SERVER_ERROR'
      ? { ...shape, message: INTERNAL_ERROR_MESSAGE, data: { ...shape.data, requestId: ctx?.requestId } }
      : shape,
});

export const router = t.router;

const ERROR_CODES: Record<DomainErrorKind, TRPCError['code']> = {
  DELIVERY_HELD_BY_ANOTHER_SHIP: 'FORBIDDEN',
  DELIVERY_NOT_FOUND: 'NOT_FOUND',
  DELIVERY_NOT_IN_FLIGHT: 'CONFLICT',
  FLEET_ALREADY_EXISTS: 'CONFLICT',
  FLEET_NOT_FOUND: 'NOT_FOUND',
  IDEMPOTENCY_KEY_REUSED: 'CONFLICT',
  IN_REPLY_TO_NOT_FOUND: 'NOT_FOUND',
  INVALID_CONTENT_TYPE: 'BAD_REQUEST',
  INVALID_EMAIL: 'BAD_REQUEST',
  INVALID_FLEET_NAME: 'BAD_REQUEST',
  INVALID_IDEMPOTENCY_KEY: 'BAD_REQUEST',
  INVALID_LOCATION: 'BAD_REQUEST',
  INVALID_PASSWORD: 'BAD_REQUEST',
  INVALID_RECEIVE_MAX: 'BAD_REQUEST',
  INVALID_SHIP_NAME: 'BAD_REQUEST',
  INVALID_SHIP_NOTE: 'BAD_REQUEST',
  INVALID_SHIP_TYPE: 'BAD_REQUEST',
  // The crew token belonged to that lease: it no longer authenticates anyone.
  LEASE_ENDED: 'UNAUTHORIZED',
  NOT_THE_OPERATOR_SHIP: 'FORBIDDEN',
  OPERATOR_SHIP_GETS_NO_STARTING_PROMPT: 'FORBIDDEN',
  OPERATOR_SHIP_HAS_NO_SECRET: 'FORBIDDEN',
  OPERATOR_SHIP_IS_PERMANENT: 'FORBIDDEN',
  // BAD_REQUEST, as when the schema at the door refuses the same payload.
  PAYLOAD_TOO_LARGE: 'BAD_REQUEST',
  SHIP_NAME_RESERVED: 'CONFLICT',
  SHIP_NAME_TAKEN: 'CONFLICT',
  SHIP_NOT_AWAITING_CREW: 'CONFLICT',
  SHIP_NOT_CREWED: 'CONFLICT',
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

type InputPath = readonly (string | number)[];

/** Where in the input the first text holding U+0000 is; undefined when no text does. */
function pathToNul(value: unknown, path: InputPath): InputPath | undefined {
  if (typeof value === 'string') {
    return value.includes('\u0000') ? path : undefined;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = pathToNul(item, [...path, index]);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      const found = pathToNul(item, [...path, key]);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

/** A field's path as a caller writes it: `location.description`, `items[2].note`. */
function fieldName(path: InputPath): string {
  return path.map((part, index) => (typeof part === 'number' ? `[${part}]` : index === 0 ? part : `.${part}`)).join('');
}

/**
 * A procedure that needs no caller: the base of every procedure, of the
 * console procedures, and of `register`, which takes the ship secret.
 *
 * Postgres text can never store the character U+0000, so this one check at
 * the door refuses it in any text input, as a bad request naming the field,
 * before anything else reads the input.
 */
export const publicProcedure = t.procedure.use(async ({ getRawInput, next }) => {
  // Input that does not parse is left to the procedure: one without input,
  // such as sign-out with an empty body, never reads it; one with input
  // refuses it as before.
  const input: unknown = await getRawInput().catch(() => undefined);
  const path = pathToNul(input, []);
  if (path) {
    const where = path.length === 0 ? 'The input' : `The input field ${fieldName(path)}`;
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${where} cannot hold the character U+0000 (NUL)` });
  }
  return next();
});

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
 * A procedure only a crew calls, with the crew token `register` gave it, and
 * that needs the given scope: receiving and acknowledging deliveries, which a
 * crew claims under its lease. The console session is no crew token, so it is
 * refused here; argo's inbox comes with its own procedures.
 */
export function crewProcedure(scope: Scope) {
  return publicProcedure.use(async ({ ctx, next }) => {
    const { bearer } = ctx.credentials;
    const crew = bearer === undefined ? undefined : await ctx.useCases.authenticate.byCrewToken(bearer);
    if (!crew) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Call with the crew token register gave you' });
    }
    if (!hasScope(crew, scope)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `This call needs the ${scope} scope` });
    }
    return next({ ctx: { caller: crew, crew } });
  });
}

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
