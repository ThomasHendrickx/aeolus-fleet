/**
 * The ship contract as the REST and MCP doors see it (ADR 0004): every
 * procedure under `ship` in the router, then the fleet actions a ship with
 * fleet scopes may call, read from the router itself. For each
 * one: its name, what it says about itself, and the JSON Schema of its input
 * and output, generated from the procedure's own Zod parsers. A call goes
 * through the router with the raw input, so its middlewares and its input
 * parsing run exactly as they do for `/trpc`; the doors hold no logic of
 * their own.
 */
import { callTRPCProcedure, getTRPCErrorFromUnknown, type TRPC_ERROR_CODE_KEY, type TRPCError } from '@trpc/server';
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

const metaSchema: z.ZodType<ProcedureMeta> = z.object({ description: z.string().min(1), example: z.record(z.string(), z.string()).optional() });

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

/** What a procedure takes: none without an input parser; optional when its parser takes nothing at all. */
function inputOf(parser: unknown): ShipCall['input'] {
  if (parser === undefined) {
    return undefined;
  }
  const input = zodParser(parser);
  return { schema: jsonSchemaOf(input, 'input'), isRequired: !input.safeParse(undefined).success };
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
  'ping',
  'follow',
  'crewRequest',
  'removeCrewRequest',
  'assignCrew',
  'explainCrewRequest',
  'reportCrewStatus',
  'confirmCrewRelease',
  'assignedCrewRequests',
  'labels',
  'defineLabel',
  'changeLabelValues',
  'assignLabel',
  'unassignLabel',
  'deleteLabel',
  'findLabelValue',
] as const;

type Procedure = (typeof appRouter.ship)[keyof typeof appRouter.ship] | (typeof appRouter.fleet)[(typeof FLEET_ACTIONS)[number]];

/** One procedure as a door offers it, under its tool name and REST route. */
function callOf(procedure: Procedure, at: { name: string; route: string; path: string; credential: ShipCall['credential'] }): ShipCall {
  const { type, inputs, meta } = procedure._def;
  // The output parser is on the procedure at runtime, though tRPC's types leave it out.
  const output = 'output' in procedure._def ? procedure._def.output : undefined;
  const input = inputOf(inputs[0]);
  const { description, example } = metaSchema.parse(meta);
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

/**
 * What a caller learns of a call that did not succeed: the code, its HTTP
 * status and a message it may read. The code is tRPC's, or LEASE_ENDED for a
 * crew whose ship was released.
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
function refusalOf(error: TRPCError, at: { call: ShipCall; requestId: string }): ShipCallRefusal {
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
function inputRefusalOf(error: z.ZodError, call: ShipCall): string {
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
