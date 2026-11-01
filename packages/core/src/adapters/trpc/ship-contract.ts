/**
 * The ship contract as the REST and MCP doors see it (ADR 0004): every
 * procedure under `ship` in the router, then the fleet actions a ship with
 * fleet scopes may call, read from the router itself. For each
 * one: its name, what it says about itself, and the JSON Schema of its input
 * and output, generated from the procedure's own Zod parsers. A call goes
 * through the router with the raw input, so its middlewares and its input
 * parsing run exactly as they do for `/trpc`; the doors hold no logic of
 * their own. Beside the calls, the streams REST serves as server-sent
 * events: the fleet's events (`fleet.events`).
 */
import { fleetStreamItemSchema } from '@aeolus-fleet/common';
import { callTRPCProcedure, getTRPCErrorFromUnknown, isTrackedEnvelope, type TRPC_ERROR_CODE_KEY, type TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import { z } from 'zod';

import { failureForLog, type LoggedFailure } from '../prisma/failure-log.js';
import type { Context } from './context.js';
import { appRouter } from './router.js';
import { INTERNAL_ERROR_MESSAGE, ShipRefusalCode, type ProcedureMeta } from './trpc.js';

type JsonValue = z.infer<ReturnType<typeof z.json>>;

/** A JSON Schema for an object: what a ship call takes or answers. */
export interface ObjectSchema {
  type: 'object';
  properties: Record<string, Record<string, JsonValue>>;
  required: string[];
  [keyword: string]: unknown;
}

/** One call of the ship contract, as a door offers it. */
export interface ShipCall {
  /** The name agents call it by, the MCP tool's: `send`, `ack`, or `fleet_list` for a fleet action. */
  name: string;
  /** Where REST serves it, under `/api/v1`: `/ship/send`, `/fleet/list`. */
  route: string;
  /** GET for a query without input, POST with a JSON body for the others. */
  method: 'GET' | 'POST';
  /** The procedure's path in the router, such as `ship.send`. */
  path: string;
  type: 'query' | 'mutation';
  /** What it does and its rules, from the procedure's meta, with its example when it has one. */
  description: string;
  /** Arguments it takes as they stand, as JSON, when its procedure gives an example. */
  example?: string;
  /** How the caller says who it is: the ship secret in the input (`register`), or the crew token. */
  credential: 'secret' | 'crewToken';
  /** What it takes, if anything, and whether it may be left out (`receive`). */
  input?: { schema: ObjectSchema; isRequired: boolean };
  /** What it answers: an object, or a list for `fleet_list`. */
  output: JsonSchema;
}

/** A JSON Schema of any shape: what a call answers. */
export type JsonSchema = Record<string, unknown>;

const objectSchema = z.looseObject({
  type: z.literal('object'),
  properties: z.record(z.string(), z.record(z.string(), z.json())).default({}),
  required: z.array(z.string()).default([]),
});

const metaSchema: z.ZodType<ProcedureMeta> = z.object({
  description: z.string().min(1),
  example: z.record(z.string(), z.string()).optional(),
  requiredOfCrews: z.array(z.string()).optional(),
});

/** A procedure's parser, which must be Zod so its JSON Schema can be generated. */
function zodParser(parser: unknown): z.ZodType {
  if (!(parser instanceof z.ZodType)) {
    throw new TypeError('A ship procedure parses its input and output with Zod, so its JSON Schema can be generated');
  }
  return parser;
}

/** The JSON Schema of a procedure's parser: what it takes (`input`) or what it answers (`output`). */
function jsonSchemaOf(parser: z.ZodType, io: 'input' | 'output'): ObjectSchema {
  // JSON Schema 2020-12, the dialect of OpenAPI 3.1 and MCP alike; naming it is left to the document holding it.
  const schema: Record<string, unknown> = { ...z.toJSONSchema(parser, { io }) };
  delete schema.$schema;
  return objectSchema.parse(schema);
}

/**
 * What a procedure takes: none without an input parser; optional when its
 * parser takes nothing at all. The fields it requires of crews are required
 * too, in the order of its properties.
 */
function inputOf(parser: unknown, requiredOfCrews: readonly string[]): ShipCall['input'] {
  if (parser === undefined) {
    return undefined;
  }
  const input = zodParser(parser);
  const schema = jsonSchemaOf(input, 'input');
  const required = Object.keys(schema.properties).filter((field) => schema.required.includes(field) || requiredOfCrews.includes(field));
  return { schema: { ...schema, required }, isRequired: !input.safeParse(undefined).success };
}

/** What a procedure answers, as a JSON Schema of any shape. */
function outputSchemaOf(parser: z.ZodType): JsonSchema {
  const schema: JsonSchema = { ...z.toJSONSchema(parser, { io: 'output' }) };
  delete schema.$schema;
  return schema;
}

/**
 * The fleet actions the doors offer a ship with fleet scopes (#85): reading
 * the fleet and the actions that manage its ships. The router checks the
 * scope of each; the other fleet procedures stay the console's.
 */
const FLEET_ACTIONS = [
  'list',
  'ship',
  'commission',
  'getStartingPrompt',
  'release',
  'recrew',
  'retire',
  'schedules',
  'pauseSchedule',
  'cancelSchedule',
  'ping',
  'follow',
  'crewRequest',
  'removeCrewRequest',
  'assignCrew',
  'explainCrewRequest',
  'reportCrewStatus',
  'reportActivity',
  'confirmCrewRelease',
  'giveBackCrewRequest',
  'assignedCrewRequests',
  'clearWorktree',
  'clearRequests',
  'confirmWorktreeCleared',
  'labels',
  'defineLabel',
  'changeLabelValues',
  'assignLabel',
  'unassignLabel',
  'deleteLabel',
  'findLabelValue',
  'networkRules',
  'saveNetworkRulesDraft',
  'discardNetworkRulesDraft',
  'networkRulesDraftChanges',
  'applyNetworkRules',
  'exportNetworkRules',
  'checkNetworkRulesFile',
  'importNetworkRules',
  'setBuiltInRule',
  'declareNetworkRules',
  'declaredNetworkRules',
  'scopes',
  'declareScopes',
  'grantScopes',
  'defineScope',
  'describeScope',
  'removeScope',
  'setVerifiedFacts',
  'setExpectations',
  'raiseAlert',
  'clearAlert',
  'openAlerts',
  'checkManage',
  'limits',
] as const;

type Procedure = (typeof appRouter.ship)[keyof typeof appRouter.ship] | (typeof appRouter.fleet)[(typeof FLEET_ACTIONS)[number]];

/** One procedure as a door offers it, under its tool name and REST route. */
function callOf(procedure: Procedure, at: { name: string; route: string; path: string; credential: ShipCall['credential'] }): ShipCall {
  const { type, inputs, meta } = procedure._def;
  // The output parser is on the procedure at runtime, though tRPC's types leave it out.
  const output = 'output' in procedure._def ? procedure._def.output : undefined;
  const { description, example, requiredOfCrews = [] } = metaSchema.parse(meta);
  const input = inputOf(inputs[0], requiredOfCrews);
  const exampleJson = example === undefined ? undefined : JSON.stringify(example);
  return {
    ...at,
    method: type === 'query' && input === undefined ? 'GET' : 'POST',
    type,
    description: exampleJson === undefined ? description : `${description} Example: ${exampleJson}`,
    ...(exampleJson !== undefined && { example: exampleJson }),
    input,
    output: outputSchemaOf(zodParser(output)),
  };
}

/**
 * Every procedure under `ship`, in the router's order, then the fleet actions.
 * Built once: the router never changes while the server runs.
 */
export const SHIP_CALLS: readonly ShipCall[] = [
  ...Object.entries(appRouter.ship).map(([name, procedure]) =>
    callOf(procedure, { name, route: `/ship/${name}`, path: `ship.${name}`, credential: name === 'register' ? 'secret' : 'crewToken' }),
  ),
  ...FLEET_ACTIONS.map((name) =>
    callOf(appRouter.fleet[name], { name: `fleet_${name}`, route: `/fleet/${name}`, path: `fleet.${name}`, credential: 'crewToken' }),
  ),
];

/** A subscription REST serves as server-sent events, each item with its id. */
export interface ShipStream {
  /** The name the spec gives it: `fleet_events`. */
  name: string;
  /** Where REST serves it, under `/api/v1`, as GET: `/fleet/events`. */
  route: string;
  /** The subscription's path in the router, such as `fleet.events`. */
  path: string;
  /** What it sends and its rules, from the subscription's meta. */
  description: string;
  /** What each item's data is. */
  item: JsonSchema;
}

/**
 * The fleet's committed events (`fleet.events`), as the console follows
 * them: REST takes the position from `Last-Event-ID`, the header a reopening
 * client sends, as the console's `lastEventId`.
 */
export const FLEET_EVENTS_STREAM: ShipStream = {
  name: 'fleet_events',
  route: '/fleet/events',
  path: 'fleet.events',
  description: metaSchema.parse(appRouter.fleet.events._def.meta).description,
  item: outputSchemaOf(fleetStreamItemSchema),
};

/** What a stream sends: an item with its id, or the refusal it ends with once its caller no longer holds. */
export type ShipStreamMessage = { kind: 'item'; id: string; data: unknown } | { kind: 'end'; refusal: ShipCallRefusal };

/** A stream opened, or the refusal that opens none. */
export type ShipStreamOpening = { isOk: true; messages: AsyncIterable<ShipStreamMessage> } | { isOk: false; refusal: ShipCallRefusal };

/**
 * What a caller learns of a call that did not succeed: the code, its HTTP
 * status and a message it may read. The code is tRPC's, or LEASE_ENDED for a
 * crew whose ship was released, or a delivery's own code for a refusal about
 * that delivery (#832).
 */
export interface ShipCallRefusal {
  code: TRPC_ERROR_CODE_KEY | ShipRefusalCode['code'];
  httpStatus: number;
  message: string;
  /** Only for a server failure: the request's id, under which the server log holds the whole failure. */
  requestId?: string;
}

export type ShipCallResult = { isOk: true; output: unknown } | { isOk: false; refusal: ShipCallRefusal };

/** Where a failure is logged whole: the request's own logger, which labels it with the request's id. */
export interface FailureLog {
  error(details: { path?: string } & LoggedFailure, message: string): void;
}

/** A refusal as a JSON body: its code and message, and for a server failure the request's id. */
export function refusalBody(refusal: ShipCallRefusal): { code: string; message: string; requestId?: string } {
  const { code, message, requestId } = refusal;
  return requestId === undefined ? { code, message } : { code, message, requestId };
}

/**
 * A failure in a door itself, outside any procedure: the log holds it whole,
 * under the request's id, and the caller learns only that it failed, as for
 * a procedure's server failure.
 */
export function unexpectedFailure(thrown: unknown, request: { log: FailureLog; requestId: string }): ShipCallRefusal {
  const error = getTRPCErrorFromUnknown(thrown);
  request.log.error(failureForLog(error), 'request failed');
  return { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, message: INTERNAL_ERROR_MESSAGE, requestId: request.requestId };
}

/**
 * What a caller reads of an error. A refusal keeps its code and message, an
 * input that does not parse reads as one line per problem and field, then the
 * call's example when it has one, and a server failure says only that it
 * failed, with the request's id, as the router's error formatter does for
 * `/trpc`.
 */
function refusalOf(error: TRPCError, at: { call: Pick<ShipCall, 'name' | 'example'>; requestId: string }): ShipCallRefusal {
  const { call, requestId } = at;
  const httpStatus = getHTTPStatusCodeFromError(error);
  if (error.code === 'INTERNAL_SERVER_ERROR') {
    return { code: error.code, httpStatus, message: INTERNAL_ERROR_MESSAGE, requestId };
  }
  const message = error.cause instanceof z.ZodError ? inputRefusalOf(error.cause, call) : error.message;
  const code = error.cause instanceof ShipRefusalCode ? error.cause.code : error.code;
  return { code, httpStatus, message };
}

/** Input that does not parse: one line per problem and field, then how the call takes it when it has an example. */
function inputRefusalOf(error: z.ZodError, call: Pick<ShipCall, 'name' | 'example'>): string {
  const problems = z.prettifyError(error);
  return call.example === undefined ? problems : `${problems}\nCall ${call.name} like this: ${call.example}`;
}

/**
 * Calls the procedure with the raw input, as the context's caller. The
 * credentials in the context are the door's: a bearer crew token for REST, the
 * `crewToken` argument for MCP. A server failure goes to the log whole, as
 * `/trpc` logs it; the caller learns only that it failed.
 */
export async function callShip(
  call: ShipCall,
  request: { ctx: Context; input: unknown; log: FailureLog },
): Promise<ShipCallResult> {
  const { ctx, input, log } = request;
  try {
    const output: unknown = await callTRPCProcedure({
      router: appRouter,
      path: call.path,
      type: call.type,
      ctx,
      getRawInput: () => Promise.resolve(input),
      signal: undefined,
      batchIndex: 0,
    });
    return { isOk: true, output };
  } catch (thrown) {
    const error = getTRPCErrorFromUnknown(thrown);
    if (error.code === 'INTERNAL_SERVER_ERROR') {
      log.error({ path: call.path, ...failureForLog(error) }, 'procedure failed');
    }
    return { isOk: false, refusal: refusalOf(error, { call, requestId: ctx.requestId }) };
  }
}

/**
 * Opens the subscription with the raw input, as the context's caller, so its
 * middlewares refuse before anything is sent. Once open, each item it yields
 * is a message with its tracked id; a refusal while it runs, such as a lease
 * that ended or a scope revoked, is its last message. The stream ends when
 * the subscription does, or once `signal` aborts.
 */
export async function openShipStream(
  stream: ShipStream,
  request: { ctx: Context; input: unknown; log: FailureLog; signal: AbortSignal },
): Promise<ShipStreamOpening> {
  const { ctx, input, log, signal } = request;
  const refusalFor = (thrown: unknown): ShipCallRefusal => {
    const error = getTRPCErrorFromUnknown(thrown);
    if (error.code === 'INTERNAL_SERVER_ERROR') {
      log.error({ path: stream.path, ...failureForLog(error) }, 'subscription failed');
    }
    return refusalOf(error, { call: stream, requestId: ctx.requestId });
  };
  let items: unknown;
  try {
    items = await callTRPCProcedure({
      router: appRouter,
      path: stream.path,
      type: 'subscription',
      ctx,
      getRawInput: () => Promise.resolve(input),
      signal,
      batchIndex: 0,
    });
  } catch (thrown) {
    return { isOk: false, refusal: refusalFor(thrown) };
  }
  if (!isAsyncIterable(items)) {
    throw new TypeError(`${stream.path} is a subscription that yields its items`);
  }
  return { isOk: true, messages: messagesOf(items, refusalFor) };
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}

/** A subscription's tracked items as messages, then the refusal it ended with, if it did. */
async function* messagesOf(items: AsyncIterable<unknown>, refusalFor: (thrown: unknown) => ShipCallRefusal): AsyncGenerator<ShipStreamMessage> {
  try {
    for await (const item of items) {
      if (!isTrackedEnvelope(item)) {
        throw new TypeError('A ship stream tracks each item by its id');
      }
      const [id, data] = item;
      yield { kind: 'item', id, data };
    }
  } catch (thrown) {
    yield { kind: 'end', refusal: refusalFor(thrown) };
  }
}
