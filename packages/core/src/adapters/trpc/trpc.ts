import { idSchema, type Scope } from '@aeolus-fleet/common';
import { initTRPC, TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';

import { hasScope, isCrew, isShipCaller, type AccountCaller, type Caller, type ShipCaller, type Crew } from '../../domain/shared/caller.js';
import type { DomainError, DomainErrorKind } from '../../domain/shared/errors.js';
import type { Result } from '../../domain/shared/result.js';
import { isFleetBusy } from '../prisma/fleet-busy.js';
import { measureCall } from '../telemetry/calls.js';
import type { Context } from './context.js';
import { INSTALLATION_TOKEN_HEADER, isInstallationToken } from './installation-token.js';

/** All a caller learns of a server failure, with the request's id; the log keeps the rest under that id. */
export const INTERNAL_ERROR_MESSAGE = 'Internal error';

/** What a caller reads when the database was too busy for the call: it stored nothing and can be made again. */
export const FLEET_BUSY_MESSAGE =
  'The fleet is busy; nothing was stored. Make the same call again (for send, with the same idempotency key).';

/**
 * What a procedure says about itself. A ship procedure's description is what
 * an agent reads on every call, as an MCP tool or a REST operation: what it
 * does and the rules for using it.
 */
export interface ProcedureMeta {
  description: string;
  /** Arguments the call takes as they stand, shown with the description and with a refusal of arguments that do not parse. */
  example?: Readonly<Record<string, string>>;
  /**
   * Input fields the parser leaves optional only for argo's console session,
   * which never comes through REST or MCP: there every caller is a crew, so
   * the doors' schemas mark them required.
   */
  requiredOfCrews?: readonly string[];
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
  ACCOUNT_TOKEN_ENDED: 'UNAUTHORIZED',
  ACCOUNT_TOKEN_INVALID: 'UNAUTHORIZED',
  DELIVERY_HELD_BY_ANOTHER_SHIP: 'FORBIDDEN',
  DELIVERY_NOT_FOUND: 'NOT_FOUND',
  DELIVERY_NOT_A_PING: 'CONFLICT',
  ASSIGNEE_NOT_ACTIVE: 'BAD_REQUEST',
  CLEAR_REQUEST_LIMIT_REACHED: 'FORBIDDEN',
  CLEAR_REQUEST_NOT_FOUND: 'NOT_FOUND',
  NOT_A_TRIERARCH: 'BAD_REQUEST',
  NOT_AN_AGENT_SHIP: 'BAD_REQUEST',
  CREW_REQUEST_ALREADY_ASSIGNED: 'CONFLICT',
  CREW_REQUEST_NOT_ASSIGNED_TO_CALLER: 'FORBIDDEN',
  CREW_REQUEST_NOT_FOUND: 'NOT_FOUND',
  CREW_REQUEST_NOT_RELEASING: 'CONFLICT',
  CREW_REQUEST_RELEASING: 'CONFLICT',
  CREW_REQUEST_FINAL: 'CONFLICT',
  CREW_REQUEST_SETTINGS_CHANGED: 'CONFLICT',
  // Settings that are not crew settings would never be placed (#809): a bad request, as the input itself.
  CREW_REQUEST_SETTINGS_INVALID: 'BAD_REQUEST',
  // BAD_REQUEST, as for a payload or report details over their limit.
  CREW_REQUEST_SETTINGS_TOO_LARGE: 'BAD_REQUEST',
  DELIVERY_NOT_IN_FLIGHT: 'CONFLICT',
  DELIVERY_NOT_ACKNOWLEDGED: 'CONFLICT',
  DELIVERY_HANDED_ONCE_MORE: 'CONFLICT',
  DELIVERY_NOT_HANDED_ONCE_MORE: 'CONFLICT',
  DELIVERY_NOT_OPEN: 'CONFLICT',
  DELIVERY_NOT_UNDELIVERABLE: 'CONFLICT',
  FLEET_ALREADY_EXISTS: 'CONFLICT',
  FLEET_LIMIT_REACHED: 'FORBIDDEN',
  FLEET_NOT_FOUND: 'NOT_FOUND',
  FLEET_HAS_NO_VIEWER: 'NOT_FOUND',
  VIEWER_TICKET_NAMES_NO_ACCOUNT: 'BAD_REQUEST',
  FORCE_NOT_ALLOWED: 'FORBIDDEN',
  NOTICE_NOT_FOUND: 'NOT_FOUND',
  NOTICE_NOT_DISMISSIBLE: 'BAD_REQUEST',
  GUIDE_NOT_FOUND: 'NOT_FOUND',
  GUIDE_STEP_NOT_FOUND: 'BAD_REQUEST',
  IDEMPOTENCY_KEY_REUSED: 'CONFLICT',
  IN_REPLY_TO_NOT_FOUND: 'NOT_FOUND',
  MESSAGE_LIMIT_REACHED: 'FORBIDDEN',
  MEETING_WITHOUT_INVITEES: 'BAD_REQUEST',
  MEETING_NOT_FOUND: 'NOT_FOUND',
  SCHEDULE_NOT_FOUND: 'NOT_FOUND',
  SCHEDULE_ENDED: 'CONFLICT',
  SCHEDULE_CANCELLED: 'CONFLICT',
  INVALID_TIMING: 'BAD_REQUEST',
  INVALID_RETRY_WINDOW: 'BAD_REQUEST',
  INVALID_GRACE: 'BAD_REQUEST',
  FORBIDDEN: 'FORBIDDEN',
  MEETING_ENDED: 'CONFLICT',
  CONTRIBUTION_REPLIES: 'BAD_REQUEST',
  CONTRIBUTION_FORCED: 'BAD_REQUEST',
  MIC_ALREADY_REQUESTED: 'CONFLICT',
  MIC_ALREADY_HELD: 'CONFLICT',
  MODERATOR_NEEDS_NO_MIC: 'BAD_REQUEST',
  MIC_NOT_REQUESTED: 'CONFLICT',
  MIC_NOT_HELD: 'CONFLICT',
  MIC_FREE: 'CONFLICT',
  NOT_MODERATOR: 'FORBIDDEN',
  PARTICIPANT_NOT_FOUND: 'NOT_FOUND',
  PARTICIPANT_LEFT: 'CONFLICT',
  PARTICIPANT_REVOKED: 'FORBIDDEN',
  ALREADY_PRESENT: 'CONFLICT',
  OWNER_CANNOT_LEAVE: 'CONFLICT',
  NOT_OWNER: 'FORBIDDEN',
  NOT_OWNER_OR_MODERATOR: 'FORBIDDEN',
  MODEL_REQUIRED: 'BAD_REQUEST',
  INVALID_HARNESS: 'BAD_REQUEST',
  MODEL_FROM_ARGO: 'BAD_REQUEST',
  MODEL_FROM_PERSON_APP_OR_PLUGIN: 'BAD_REQUEST',
  INVALID_CONTENT_TYPE: 'BAD_REQUEST',
  INVALID_EMAIL: 'BAD_REQUEST',
  INVALID_FLEET_NAME: 'BAD_REQUEST',
  INVALID_FOLLOW_MAX: 'BAD_REQUEST',
  INVALID_FOLLOW_WAIT: 'BAD_REQUEST',
  INVALID_IDEMPOTENCY_KEY: 'BAD_REQUEST',
  INVALID_INBOX_WAIT: 'BAD_REQUEST',
  INVALID_LABEL_KEY: 'BAD_REQUEST',
  INVALID_LABEL_VALUE: 'BAD_REQUEST',
  INVALID_LABEL_VALUES: 'BAD_REQUEST',
  INVALID_LIMIT: 'BAD_REQUEST',
  INVALID_LOCATION: 'BAD_REQUEST',
  INVALID_NETWORK_RULES: 'BAD_REQUEST',
  INVALID_NETWORK_RULES_FILE: 'BAD_REQUEST',
  INVALID_PASSWORD: 'BAD_REQUEST',
  INVALID_RECEIVE_MAX: 'BAD_REQUEST',
  INVALID_CREW_REQUEST_REASON: 'BAD_REQUEST',
  INVALID_REPORT_DETAILS: 'BAD_REQUEST',
  INVALID_REPORT_NOTE: 'BAD_REQUEST',
  INVALID_REPORT_STATE: 'BAD_REQUEST',
  INVALID_SHIP_NAME: 'BAD_REQUEST',
  INVALID_SHIP_NOTE: 'BAD_REQUEST',
  INVALID_SHIP_TYPE: 'BAD_REQUEST',
  // The crew token belonged to that lease: it no longer authenticates anyone.
  LABEL_CARRIED: 'CONFLICT',
  LABEL_DIFFERENCES: 'CONFLICT',
  LABEL_KEY_TAKEN: 'CONFLICT',
  ACCOUNT_OWNS_NO_LABEL: 'FORBIDDEN',
  INVALID_SCOPE: 'BAD_REQUEST',
  INVALID_SCOPE_DESCRIPTION: 'BAD_REQUEST',
  CORE_NAMESPACE: 'BAD_REQUEST',
  NAMESPACE_TAKEN: 'CONFLICT',
  SECOND_NAMESPACE: 'CONFLICT',
  TOO_MANY_SCOPES: 'BAD_REQUEST',
  RESERVED_NAMESPACE: 'BAD_REQUEST',
  SCOPE_DEFINED: 'CONFLICT',
  SCOPE_HELD: 'CONFLICT',
  SCOPE_NOT_DEFINED: 'NOT_FOUND',
  SCOPE_NOT_DECLARED: 'BAD_REQUEST',
  SCOPE_NOT_HELD: 'FORBIDDEN',
  BASE_SCOPE: 'BAD_REQUEST',
  SHIP_SCOPES_FIXED: 'FORBIDDEN',
  OWN_SHIP_SCOPES: 'FORBIDDEN',
  NOT_ALLOWED_AS_ARGO: 'FORBIDDEN',
  LABEL_NOT_FOUND: 'NOT_FOUND',
  LABEL_VALUE_CARRIED: 'CONFLICT',
  LABEL_VALUE_NOT_FOUND: 'NOT_FOUND',
  LEASE_ENDED: 'UNAUTHORIZED',
  MESSAGE_NOT_FOUND: 'NOT_FOUND',
  NOT_THE_LABEL_OWNER: 'FORBIDDEN',
  NOT_YOUR_SHIP_TO_LABEL: 'FORBIDDEN',
  NOT_REACHABLE: 'FORBIDDEN',
  BUILT_IN_RULE_FIXED: 'FORBIDDEN',
  NETWORK_SETTINGS_CHANGED: 'CONFLICT',
  NO_NETWORK_RULES_DRAFT: 'NOT_FOUND',
  INVALID_OWNER: 'BAD_REQUEST',
  NOT_THE_OPERATOR_SHIP: 'FORBIDDEN',
  OPERATOR_EMAIL_TAKEN: 'CONFLICT',
  OPERATOR_HAS_NO_PASSWORD: 'CONFLICT',
  NO_OWN_SIGN_IN: 'FORBIDDEN',
  OPERATOR_SHIP_GETS_NO_STARTING_PROMPT: 'FORBIDDEN',
  OPERATOR_SHIP_HAS_NO_SECRET: 'FORBIDDEN',
  OPERATOR_SHIP_IS_NOT_PINGED: 'FORBIDDEN',
  OPERATOR_SHIP_IS_PERMANENT: 'FORBIDDEN',
  // BAD_REQUEST, as when the schema at the door refuses the same payload.
  PAYLOAD_TOO_LARGE: 'BAD_REQUEST',
  PING_NOT_RESENT: 'CONFLICT',
  // BAD_REQUEST, as for a payload over its limit.
  REPORT_DETAILS_TOO_LARGE: 'BAD_REQUEST',
  RESERVED_CONTENT_TYPE: 'FORBIDDEN',
  SCHEDULE_INTERVAL_TOO_SHORT: 'FORBIDDEN',
  SCHEDULE_LIMIT_REACHED: 'FORBIDDEN',
  SHIP_ALREADY_RETIRED: 'CONFLICT',
  SHIP_HAS_NO_OWNER: 'FORBIDDEN',
  SHIP_NAME_RESERVED: 'CONFLICT',
  SHIP_NAME_TAKEN: 'CONFLICT',
  SHIP_NOT_AWAITING_CREW: 'CONFLICT',
  SHIP_NOT_CREWED: 'CONFLICT',
  SHIP_LABEL_LIMIT_REACHED: 'BAD_REQUEST',
  SHIP_LIMIT_REACHED: 'FORBIDDEN',
  SHIP_NOT_FOUND: 'NOT_FOUND',
  SHIP_NOT_READ_ON_BEHALF: 'FORBIDDEN',
  SIGN_IN_TICKET_INVALID: 'UNAUTHORIZED',
  UNKNOWN_CREW_TOKEN: 'UNAUTHORIZED',
  UNRESOLVABLE_SELECTOR: 'NOT_FOUND',
  WRONG_EMAIL_OR_PASSWORD: 'UNAUTHORIZED',
  // FORBIDDEN, not UNAUTHORIZED: the console session that asked stays signed in.
  WRONG_PASSWORD: 'FORBIDDEN',
  WRONG_SHIP_ID_OR_SECRET: 'UNAUTHORIZED',
};

/**
 * The refusals a ship reads by their own code, which their tRPC code would
 * hide: a crew whose lease has ended reads LEASE_ENDED, not UNAUTHORIZED, so
 * it can tell a released ship from a wrong crew token; a refusal about a
 * delivery reads its delivery code, not CONFLICT or FORBIDDEN, so a crew can
 * tell what became of that delivery, and that its crew token still holds (#832).
 */
const SHIP_REFUSAL_CODES = [
  'LEASE_ENDED',
  'DELIVERY_HANDED_ONCE_MORE',
  'DELIVERY_HELD_BY_ANOTHER_SHIP',
  'DELIVERY_NOT_FOUND',
  'DELIVERY_NOT_A_PING',
  'DELIVERY_NOT_ACKNOWLEDGED',
  'DELIVERY_NOT_HANDED_ONCE_MORE',
  'DELIVERY_NOT_IN_FLIGHT',
  'DELIVERY_NOT_OPEN',
  'DELIVERY_NOT_UNDELIVERABLE',
] as const satisfies readonly DomainErrorKind[];

type ShipRefusalCodeKind = (typeof SHIP_REFUSAL_CODES)[number];

function isShipRefusalCode(kind: DomainErrorKind): kind is ShipRefusalCodeKind {
  return SHIP_REFUSAL_CODES.some((code) => code === kind);
}

/**
 * The code a ship reads for a refusal whose tRPC code would hide it (see
 * SHIP_REFUSAL_CODES). The HTTP status stays the tRPC code's. The ship doors
 * read it from the tRPC error's cause.
 */
export class ShipRefusalCode extends Error {
  override name = 'ShipRefusalCode';
  readonly code: ShipRefusalCodeKind;

  constructor(code: ShipRefusalCodeKind) {
    super(code);
    this.code = code;
  }
}

/** A refusal as the matching tRPC error, keeping its message: the one place domain error kinds meet API errors. */
function apiErrorOf(error: DomainError): TRPCError {
  const { kind, message } = error;
  const cause = isShipRefusalCode(kind) ? new ShipRefusalCode(kind) : undefined;
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

/** The lowest HTTP status of a server failure, which the error rate counts; a refusal is no failure. */
const FIRST_SERVER_FAILURE_STATUS = 500;

/**
 * Every query and mutation measured (telemetry/calls.ts), whichever door it
 * came through: tRPC, REST or MCP, which all call the procedure. Outermost, so
 * it sees how the call ended after every other middleware. A subscription
 * lasts as long as its socket, so it has no duration to measure.
 */
const measuredProcedure = t.procedure.use(({ path, type, next }) =>
  type === 'subscription'
    ? next()
    : measureCall(path, async () => {
        const result = await next();
        const outcome = result.ok
          ? { code: 'OK', isServerFailure: false }
          : { code: result.error.code, isServerFailure: getHTTPStatusCodeFromError(result.error) >= FIRST_SERVER_FAILURE_STATUS };
        return { value: result, outcome };
      }),
);

/**
 * A procedure that needs no caller: the base of every procedure, of the
 * console procedures, and of `register`, which takes the ship secret.
 *
 * Postgres text can never store the character U+0000, so this one check at
 * the door refuses it in any text input, as a bad request naming the field,
 * before anything else reads the input.
 *
 * A call the database was too busy for (fleet-busy.ts) stored nothing, so it
 * is refused as SERVICE_UNAVAILABLE (503), never answered as a server
 * failure: the caller makes the same call again.
 */
export const publicProcedure = measuredProcedure.use(async ({ getRawInput, next }) => {
  // Input that does not parse is left to the procedure: one without input,
  // such as sign-out with an empty body, never reads it; one with input
  // refuses it as before.
  const input: unknown = await getRawInput().catch(() => undefined);
  const path = pathToNul(input, []);
  if (path) {
    const where = path.length === 0 ? 'The input' : `The input field ${fieldName(path)}`;
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${where} cannot hold the character U+0000 (NUL)` });
  }
  const result = await next();
  if (!result.ok && isFleetBusy(result.error)) {
    throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: FLEET_BUSY_MESSAGE, cause: result.error });
  }
  return result;
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
 * A console procedure the console's own server calls with a credential the
 * browser brought, and passes the cookie on. A server sends no Origin, and a
 * browser always does, so one from any origin but the console's is a page on
 * another site posting from a visitor's browser, and is refused.
 */
export const consoleServerProcedure = publicProcedure.use(({ ctx, next }) => {
  if (ctx.origin !== undefined) {
    checkConsoleOrigin(ctx);
  }
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
 * Resolves the ship calling from the crew token or the console session. A
 * bearer crew token wins over the cookie, and a wrong one fails rather than
 * falling back. The ship secret is no bearer: it works only for `register`
 * (ADR 0015). Using a console session keeps it, and its cookie, valid for
 * another 30 days.
 */
async function resolveShip(ctx: Context): Promise<ShipCaller | undefined> {
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
    await refuseIfSignedInElsewhere(ctx, sessionToken);
  }
  return undefined;
}

/**
 * The account of an account token (decision 0058), checked on every call. A
 * bearer crew token beside it names the ship that presented it, and a wrong
 * one fails rather than being left out.
 */
async function accountOf(ctx: Context, accountToken: string): Promise<AccountCaller> {
  const { bearer } = ctx.credentials;
  const through = bearer === undefined ? null : await crewOf(ctx, bearer);
  if (through === undefined) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: CALL_WITH_CREW_TOKEN });
  }
  return okOrThrow(await ctx.useCases.authenticateAccount(accountToken, { through }));
}

/**
 * The installation acting in the fleet the `Aeolus-Fleet` header names
 * (decision 0057), with the installation token, as the installation
 * procedures take it: none on a server without one.
 */
async function installationIn(ctx: Context, fleet: string): Promise<Caller> {
  const { configured, presented } = ctx.installation;
  if (configured === undefined || !isInstallationToken({ configured, presented })) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: `The Aeolus-Fleet header goes with the installation token in ${INSTALLATION_TOKEN_HEADER}` });
  }
  const fleetId = idSchema('fleet').safeParse(fleet);
  if (!fleetId.success) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'The Aeolus-Fleet header names no fleet id' });
  }
  return okOrThrow(await ctx.useCases.authenticateInstallation({ fleetId: fleetId.data }));
}

/**
 * Resolves the actor of a fleet call (decision 0057): the account of an
 * account token, the installation with the fleet it acts in, or else the
 * ship of the crew token or the console session, or else the account signed
 * in to the console by its token cookie (accounts design, F1).
 */
async function resolveCaller(ctx: Context): Promise<Caller | undefined> {
  const { accountToken, fleet } = ctx.credentials;
  if (accountToken !== undefined) {
    return accountOf(ctx, accountToken);
  }
  if (fleet !== undefined) {
    return installationIn(ctx, fleet);
  }
  return (await resolveShip(ctx)) ?? consoleAccountOf(ctx);
}

/**
 * The account signed in to the console by its token cookie, on the console's
 * doors only; checked on every call as the header's token is. None without
 * the cookie, or beside a crew token, which names a ship instead.
 */
export async function consoleAccountOf(ctx: Context): Promise<AccountCaller | undefined> {
  const { accountTokenCookie, bearer } = ctx.credentials;
  if (!ctx.canUseConsoleSession || accountTokenCookie === undefined || bearer !== undefined) {
    return undefined;
  }
  return okOrThrow(await ctx.useCases.authenticateAccount(accountTokenCookie, { through: null }));
}

/**
 * Refuses a console session a sign-in elsewhere ended, saying so: signing in
 * somewhere else is no failure, and the console says so calmly.
 */
export async function refuseIfSignedInElsewhere(ctx: Context, sessionToken: string): Promise<void> {
  if ((await ctx.useCases.authenticate.endOfConsoleSession(sessionToken)) === 'takenOver') {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You signed in somewhere else, which ended this console session',
      cause: new ConsoleRefusalDetails({ refusal: 'SIGNED_IN_ELSEWHERE' }),
    });
  }
}

/**
 * The caller of a live subscription as it stands now, read from the server
 * again: refused once its console session or its crew's lease ended, or once
 * it lost the scope the subscription needs; a plugin reading on behalf of a
 * ship reads as that ship again, so a revoked fleet:on-behalf ends it too
 * (decision 0046). A subscription outlives the call that opened it, so it
 * asks again each time it has news.
 */
export async function callerStillHolding(ctx: Context, scope: Scope): Promise<Caller> {
  const caller = await resolveCaller(ctx);
  if (!caller) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in, or call with the crew token register gave you' });
  }
  if (!hasScope(caller, scope)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `This call needs the ${scope} scope` });
  }
  return readerOf(ctx, caller);
}

/** What a caller without a valid crew token is told, at a door for ships and for a crew procedure. */
const CALL_WITH_CREW_TOKEN = 'Call with the crew token register gave you';

/**
 * A procedure for any ship, whatever its scopes: `whoami`, which tells a ship
 * about itself, and the console's own. The caller comes from the server,
 * never from the request: the crew token or the console session alone, so an
 * account token makes no caller here. Only a fleet:read read takes the
 * `Aeolus-On-Behalf-Of` header (decision 0034); any other call refuses it.
 */
export const authenticatedProcedure = callerProcedure({ isOnBehalfRead: false, resolve: resolveShip }).use(({ ctx, next }) =>
  next({ ctx: { caller: shipOf(ctx.caller) } }),
);

/** A console procedure for whoever is signed in to the console: argo or the viewer by the session cookie, or an account by its token cookie. */
export const signedInProcedure = callerProcedure({ isOnBehalfRead: false, resolve: async (ctx) => (await resolveShip(ctx)) ?? consoleAccountOf(ctx) });

/** The base of a fleet call for any actor (decision 0057), and of a fleet:read read, which a plugin may make on behalf of a named ship. */
const actorProcedure = callerProcedure({ isOnBehalfRead: false, resolve: resolveCaller });
const readingProcedure = callerProcedure({ isOnBehalfRead: true, resolve: resolveCaller });

/**
 * The caller as a ship: a call that sends, receives or stores something on
 * the calling ship is a ship's alone (decision 0057). An agent ship can make
 * each of them, so no right is an account's or the installation's alone.
 */
function shipOf(caller: Caller): ShipCaller {
  if (!isShipCaller(caller)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only a ship makes this call' });
  }
  return caller;
}

function refuseOnBehalfHeader(ctx: Context): void {
  if (ctx.credentials.onBehalfOf !== undefined) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only a fleet:read read takes the Aeolus-On-Behalf-Of header' });
  }
}

/**
 * Reads as the ship the `Aeolus-On-Behalf-Of` header names, when it names one:
 * after the scope check, so the plugin's own scopes open the door, and the
 * named ship's read reach filters what it reads (decision 0034).
 */
async function readerOf(ctx: Context, caller: Caller): Promise<Caller> {
  const { onBehalfOf } = ctx.credentials;
  if (onBehalfOf === undefined) {
    return caller;
  }
  if (!isShipCaller(caller)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only a ship reads on behalf of another' });
  }
  const shipId = idSchema('ship').safeParse(onBehalfOf);
  if (!shipId.success) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'The Aeolus-On-Behalf-Of header names no ship id' });
  }
  return okOrThrow(await ctx.useCases.readOnBehalf(caller, { shipId: shipId.data }));
}

function callerProcedure(options: { isOnBehalfRead: boolean; resolve: (ctx: Context) => Promise<Caller | undefined> }) {
  return publicProcedure.use(async ({ ctx, type, next }) => {
    if (!options.isOnBehalfRead) {
      refuseOnBehalfHeader(ctx);
    }
    // A mutation on the console session's cookie changes state: checked before
    // the session is used, so a forged call does not even renew it. A
    // subscription is checked too: a browser opens a WebSocket from any page
    // with the cookie, and no CORS rule keeps that page from reading the
    // answers. A crew token wins over the cookie, and no browser sends one by
    // itself.
    // An account's token cookie is checked the same way (accounts design, A3).
    const { bearer, sessionToken, accountTokenCookie } = ctx.credentials;
    if ((type === 'mutation' || type === 'subscription') && bearer === undefined && (sessionToken !== undefined || accountTokenCookie !== undefined)) {
      checkConsoleOrigin(ctx);
    }
    const caller = await options.resolve(ctx);
    if (!caller) {
      const message = ctx.canUseConsoleSession ? 'Sign in, or call with the crew token register gave you' : CALL_WITH_CREW_TOKEN;
      throw new TRPCError({ code: 'UNAUTHORIZED', message });
    }
    return next({ ctx: { caller } });
  });
}

/**
 * A procedure only a crew calls, with the crew token `register` gave it: one
 * session crewing one ship under one lease. `deregister` needs nothing more,
 * since a crew ends only its own lease. The console session is no crew token,
 * so it is refused here.
 */
export const crewProcedure = publicProcedure.use(async ({ ctx, next }) => {
  refuseOnBehalfHeader(ctx);
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
 * A fleet call any actor makes (decision 0057), needing the given scope. The
 * caller and its scopes come from the server or the checked token, never from
 * the request, and are checked before any use case runs, the same way for a
 * ship, an account or the installation.
 */
export function actorScopedProcedure(scope: Scope) {
  return (scope === 'fleet:read' ? readingProcedure : actorProcedure).use(async ({ ctx, next }) => {
    if (!hasScope(ctx.caller, scope)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `This call needs the ${scope} scope` });
    }
    return next({ ctx: { caller: await readerOf(ctx, ctx.caller) } });
  });
}

/**
 * A fleet call any actor makes needing every one of the given scopes: import
 * of the network rules, which changes the rules and defines labels (design
 * network-io, Q5). Checked before any use case runs, as for one scope.
 */
export function actorAllScopesProcedure(...scopes: [Scope, Scope, ...Scope[]]) {
  return actorProcedure.use(async ({ ctx, next }) => {
    if (!scopes.every((scope) => hasScope(ctx.caller, scope))) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `This call needs the ${scopes.join(' and ')} scopes` });
    }
    return next({ ctx: { caller: await readerOf(ctx, ctx.caller) } });
  });
}

/** A call a ship alone makes (see shipOf), needing the given scope, checked as for any actor first. */
export function scopedProcedure(scope: Scope) {
  return actorScopedProcedure(scope).use(({ ctx, next }) => next({ ctx: { caller: shipOf(ctx.caller) } }));
}

/**
 * A fleet call any actor makes with any one of the given scopes: the few a
 * trierarch makes with `crew:run` beside the scope the console uses
 * (decision 0029). Checked before any use case runs, as for one scope.
 */
export function actorAnyScopeProcedure(...scopes: [Scope, Scope, ...Scope[]]) {
  return (scopes.includes('fleet:read') ? readingProcedure : actorProcedure).use(async ({ ctx, next }) => {
    if (!scopes.some((scope) => hasScope(ctx.caller, scope))) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `This call needs the ${scopes.join(' or ')} scope` });
    }
    return next({ ctx: { caller: await readerOf(ctx, ctx.caller) } });
  });
}

/**
 * A call on a ship that an actor makes with any one of the given scopes, or
 * an account makes on its own person ship with no scope for it (decision
 * 0052): getting a starting prompt for it and releasing it, so the app it uses
 * crews it. The use case checks that the ship is its person ship. With
 * `isShipCallOtherwise`, only a ship makes the call by its scopes.
 */
export function ownPersonShipOrAnyScopeProcedure(options: { isShipCallOtherwise: boolean }, ...scopes: [Scope, Scope, ...Scope[]]) {
  return actorProcedure.use(async ({ ctx, next }) => {
    const { caller } = ctx;
    if (caller.kind === 'account' && caller.personShipId !== null) {
      return next({ ctx: { caller } });
    }
    if (!scopes.some((scope) => hasScope(caller, scope))) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `This call needs the ${scopes.join(' or ')} scope` });
    }
    return next({ ctx: { caller: options.isShipCallOtherwise ? shipOf(caller) : caller } });
  });
}

/** A call a ship alone makes with any one of the given scopes. */
export function anyScopeProcedure(...scopes: [Scope, Scope, ...Scope[]]) {
  return actorAnyScopeProcedure(...scopes).use(({ ctx, next }) => next({ ctx: { caller: shipOf(ctx.caller) } }));
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
