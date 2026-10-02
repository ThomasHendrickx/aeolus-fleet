import type { Scope } from '@aeolus-fleet/common';
import { initTRPC, TRPCError } from '@trpc/server';

import { hasScope, isCrew, type Caller, type Crew } from '../../core/shared/caller.js';
import type { DomainError, DomainErrorKind } from '../../core/shared/errors.js';
import type { Result } from '../../core/shared/result.js';
import type { Context } from './context.js';

/** All a caller learns of a server failure, with the request's id; the log keeps the rest under that id. */
export const INTERNAL_ERROR_MESSAGE = 'Internal error';

/**
 * What a procedure says about itself. A ship procedure's description is what
 * an agent reads on every call, as an MCP tool or a REST operation: what it
 * does and the rules for using it.
 */
export interface ProcedureMeta {
  description: string;
}

// Never development mode, whatever NODE_ENV says: in it tRPC puts the stack
// trace into every error it answers. A server failure answers only that it
// failed and the request's id; a refusal keeps its own code and message.
/**
 * What the console reads beside a refusal's code, to say more than "refused":
 * that the operator signed in somewhere else, or when a rate-limited sign-in
 * may try again (ISO 8601). Carried as the tRPC error's cause; the error data
 * holds its fields.
 */
export class ConsoleRefusalDetails extends Error {
  override name = 'ConsoleRefusalDetails';
  readonly details: { refusal?: 'SIGNED_IN_ELSEWHERE'; retryAt?: string };

  constructor(details: { refusal?: 'SIGNED_IN_ELSEWHERE'; retryAt?: string }) {
    super('console refusal details');
    this.details = details;
  }
}

const t = initTRPC.context<Context>().meta<ProcedureMeta>().create({
  isDev: false,
  errorFormatter: ({ shape, error, ctx }) => {
    if (error.code === 'INTERNAL_SERVER_ERROR') {
      return { ...shape, message: INTERNAL_ERROR_MESSAGE, data: { ...shape.data, requestId: ctx?.requestId } };
    }
    return error.cause instanceof ConsoleRefusalDetails
      ? { ...shape, data: { ...shape.data, ...error.cause.details } }
      : shape;
  },
});

export const router = t.router;

const ERROR_CODES: Record<DomainErrorKind, TRPCError['code']> = {
  DELIVERY_HELD_BY_ANOTHER_SHIP: 'FORBIDDEN',
  DELIVERY_NOT_FOUND: 'NOT_FOUND',
  DELIVERY_NOT_A_PING: 'CONFLICT',
  DELIVERY_NOT_IN_FLIGHT: 'CONFLICT',
  DELIVERY_NOT_OPEN: 'CONFLICT',
  DELIVERY_NOT_UNDELIVERABLE: 'CONFLICT',
  FLEET_ALREADY_EXISTS: 'CONFLICT',
  FLEET_NOT_FOUND: 'NOT_FOUND',
  IDEMPOTENCY_KEY_REUSED: 'CONFLICT',
  IN_REPLY_TO_NOT_FOUND: 'NOT_FOUND',
  INVALID_CONTENT_TYPE: 'BAD_REQUEST',
  INVALID_EMAIL: 'BAD_REQUEST',
  INVALID_FLEET_NAME: 'BAD_REQUEST',
  INVALID_FOLLOW_MAX: 'BAD_REQUEST',
  INVALID_FOLLOW_WAIT: 'BAD_REQUEST',
  INVALID_IDEMPOTENCY_KEY: 'BAD_REQUEST',
  INVALID_INBOX_WAIT: 'BAD_REQUEST',
  INVALID_LOCATION: 'BAD_REQUEST',
  INVALID_PASSWORD: 'BAD_REQUEST',
  INVALID_RECEIVE_MAX: 'BAD_REQUEST',
  INVALID_REPORT_NOTE: 'BAD_REQUEST',
  INVALID_REPORT_STATE: 'BAD_REQUEST',
  INVALID_SHIP_NAME: 'BAD_REQUEST',
  INVALID_SHIP_NOTE: 'BAD_REQUEST',
  INVALID_SHIP_TYPE: 'BAD_REQUEST',
  // The crew token belonged to that lease: it no longer authenticates anyone.
  LEASE_ENDED: 'UNAUTHORIZED',
  MESSAGE_NOT_FOUND: 'NOT_FOUND',
  NOT_THE_OPERATOR_SHIP: 'FORBIDDEN',
  OPERATOR_SHIP_GETS_NO_STARTING_PROMPT: 'FORBIDDEN',
  OPERATOR_SHIP_HAS_NO_SECRET: 'FORBIDDEN',
  OPERATOR_SHIP_IS_NOT_PINGED: 'FORBIDDEN',
  OPERATOR_SHIP_IS_PERMANENT: 'FORBIDDEN',
  // BAD_REQUEST, as when the schema at the door refuses the same payload.
  PAYLOAD_TOO_LARGE: 'BAD_REQUEST',
  PING_NOT_RESENT: 'CONFLICT',
  RESERVED_CONTENT_TYPE: 'FORBIDDEN',
  SHIP_ALREADY_RETIRED: 'CONFLICT',
  SHIP_NAME_RESERVED: 'CONFLICT',
  SHIP_NAME_TAKEN: 'CONFLICT',
  SHIP_NOT_AWAITING_CREW: 'CONFLICT',
  SHIP_NOT_CREWED: 'CONFLICT',
  SHIP_NOT_FOUND: 'NOT_FOUND',
  UNKNOWN_CREW_TOKEN: 'UNAUTHORIZED',
  UNRESOLVABLE_SELECTOR: 'NOT_FOUND',
  WRONG_EMAIL_OR_PASSWORD: 'UNAUTHORIZED',
  WRONG_SHIP_ID_OR_SECRET: 'UNAUTHORIZED',
};

/**
 * The code a ship reads for a refusal whose tRPC code would hide it: a crew
 * whose lease has ended reads LEASE_ENDED, not UNAUTHORIZED, so it can tell a
 * released ship from a wrong crew token. The HTTP status stays the tRPC
 * code's. The ship doors read it from the tRPC error's cause.
 */
export class ShipRefusalCode extends Error {
  override name = 'ShipRefusalCode';
  readonly code: 'LEASE_ENDED';

  constructor(code: 'LEASE_ENDED') {
    super(code);
    this.code = code;
  }
}

/** A refusal as the matching tRPC error, keeping its message: the one place domain error kinds meet API errors. */
function apiErrorOf(error: DomainError): TRPCError {
  const { kind, message } = error;
  const cause = kind === 'LEASE_ENDED' ? new ShipRefusalCode(kind) : undefined;
  return new TRPCError({ code: ERROR_CODES[kind], message, cause });
}

/** The value of a use case's result. A refusal becomes the matching tRPC error. */
export function okOrThrow<T>(result: Result<T, DomainError>): T {
  if (!result.isOk) {
    throw apiErrorOf(result.error);
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
 * The crew of a bearer crew token; undefined when it never crewed a ship. One
 * whose lease has ended is refused as such, so its session learns that the
 * ship was released rather than that its token is wrong.
 */
async function crewOf(ctx: Context, bearer: string): Promise<Crew | undefined> {
  const crew = await ctx.useCases.authenticate.byCrewToken(bearer);
  if (crew.isOk) {
    return crew.value;
  }
  if (crew.error.kind === 'LEASE_ENDED') {
    throw apiErrorOf(crew.error);
  }
  return undefined;
}

/**
 * Resolves the caller from the crew token or the console session. A bearer
 * crew token wins over the cookie, and a wrong one fails rather than falling
 * back. The ship secret is no bearer: it works only for `register` (ADR 0015).
 * Using a console session keeps it, and its cookie, valid for another 30 days.
 */
async function resolveCaller(ctx: Context): Promise<Caller | undefined> {
  const { bearer, sessionToken } = ctx.credentials;
  if (bearer !== undefined) {
    return crewOf(ctx, bearer);
  }
  if (sessionToken !== undefined) {
    const use = await ctx.useCases.authenticate.byConsoleSession(sessionToken);
    if (use) {
      ctx.sessionCookie.set(sessionToken, use.expiresAt);
      return use.caller;
    }
    // Signing in somewhere else is no failure: the console says so calmly.
    if ((await ctx.useCases.authenticate.endOfConsoleSession(sessionToken)) === 'takenOver') {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'You signed in somewhere else, which ended this console session',
        cause: new ConsoleRefusalDetails({ refusal: 'SIGNED_IN_ELSEWHERE' }),
      });
    }
  }
  return undefined;
}

/**
 * Refuses a live subscription whose caller no longer holds: its console
 * session ended, or its crew's lease did. A subscription outlives the call
 * that opened it, so it asks again each time it has news.
 */
export async function checkCallerStillHolds(ctx: Context): Promise<void> {
  if (!(await resolveCaller(ctx))) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in, or call with the crew token register gave you' });
  }
}

/** What a caller without a valid crew token is told, at a door for ships and for a crew procedure. */
const CALL_WITH_CREW_TOKEN = 'Call with the crew token register gave you';

/**
 * A procedure for any caller, whatever its scopes: the base of every scoped
 * procedure, and `whoami`, which tells a caller about itself. The caller comes
 * from the server, never from the request.
 */
export const authenticatedProcedure = publicProcedure.use(async ({ ctx, type, next }) => {
  // A mutation on the console session's cookie changes state: checked before
  // the session is used, so a forged call does not even renew it. A
  // subscription is checked too: a browser opens a WebSocket from any page
  // with the cookie, and no CORS rule keeps that page from reading the
  // answers. A crew token wins over the cookie, and no browser sends one by
  // itself.
  const { bearer, sessionToken } = ctx.credentials;
  if ((type === 'mutation' || type === 'subscription') && bearer === undefined && sessionToken !== undefined) {
    checkConsoleOrigin(ctx);
  }
  const caller = await resolveCaller(ctx);
  if (!caller) {
    const message = ctx.canUseConsoleSession ? 'Sign in, or call with the crew token register gave you' : CALL_WITH_CREW_TOKEN;
    throw new TRPCError({ code: 'UNAUTHORIZED', message });
  }
  return next({ ctx: { caller } });
});

/**
 * A procedure only a crew calls, with the crew token `register` gave it: one
 * session crewing one ship under one lease. `deregister` needs nothing more,
 * since a crew ends only its own lease. The console session is no crew token,
 * so it is refused here.
 */
export const crewProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const { bearer } = ctx.credentials;
  const crew = bearer === undefined ? undefined : await crewOf(ctx, bearer);
  if (!crew) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: CALL_WITH_CREW_TOKEN });
  }
  return next({ ctx: { caller: crew, crew } });
});

/**
 * A crew procedure that also needs the given scope: receiving and
 * acknowledging deliveries, which a crew claims under its lease. argo's inbox
 * comes with its own procedures.
 */
export function scopedCrewProcedure(scope: Scope) {
  return crewProcedure.use(({ ctx, next }) => {
    if (!hasScope(ctx.crew, scope)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `This call needs the ${scope} scope` });
    }
    return next();
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

/**
 * A procedure for a caller that crews its ship under a lease, with every given
 * scope: argo's inbox, which its console session calls. A console session
 * crews argo under the lease it holds; the use case refuses any ship but argo.
 */
export function scopedCrewCallerProcedure(...scopes: Scope[]) {
  return authenticatedProcedure.use(({ ctx, next }) => {
    const missing = scopes.find((scope) => !hasScope(ctx.caller, scope));
    if (missing !== undefined) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `This call needs the ${missing} scope` });
    }
    const { caller } = ctx;
    if (!isCrew(caller)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the operator inbox of argo, signed in to the console, calls this' });
    }
    return next({ ctx: { crew: caller } });
  });
}
