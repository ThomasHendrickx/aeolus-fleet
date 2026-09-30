/**
 * The ship contract as the REST and MCP doors see it (ADR 0004): every
 * procedure under `ship` in the router, read from the router itself. For each
 * one: its name, what it says about itself, and the JSON Schema of its input
 * and output, generated from the procedure's own Zod parsers. A call goes
 * through the router with the raw input, so its middlewares and its input
 * parsing run exactly as they do for `/trpc`; the doors hold no logic of
 * their own.
 */
import { callTRPCProcedure, getTRPCErrorFromUnknown, type TRPC_ERROR_CODE_KEY, type TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import { z } from 'zod';

import type { Context } from './context.js';
import { appRouter } from './router.js';
import { INTERNAL_ERROR_MESSAGE, type ProcedureMeta } from './trpc.js';

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
  /** The name agents call it by: `register`, `whoami`, `send`, `receive`, `ack`, `deregister`. */
  name: string;
  /** The procedure's path in the router, such as `ship.send`. */
  path: string;
  type: 'query' | 'mutation';
  /** What it does and its rules, from the procedure's meta. */
  description: string;
  /** How the caller says who it is: the ship secret in the input (`register`), or the crew token. */
  credential: 'secret' | 'crewToken';
  input: ObjectSchema;
  output: ObjectSchema;
}

const objectSchema = z.looseObject({
  type: z.literal('object'),
  properties: z.record(z.string(), z.record(z.string(), z.json())).default({}),
  required: z.array(z.string()).default([]),
});

const metaSchema: z.ZodType<ProcedureMeta> = z.object({ description: z.string().min(1) });

/** The JSON Schema of a procedure's parser: what it takes (`input`) or what it answers (`output`). */
function jsonSchemaOf(parser: unknown, io: 'input' | 'output'): ObjectSchema {
  if (parser === undefined) {
    return { type: 'object', properties: {}, required: [] };
  }
  if (!(parser instanceof z.ZodType)) {
    throw new TypeError('A ship procedure parses its input and output with Zod, so its JSON Schema can be generated');
  }
  // JSON Schema 2020-12, the dialect of OpenAPI 3.1 and MCP alike; naming it is left to the document holding it.
  const schema: Record<string, unknown> = { ...z.toJSONSchema(parser, { io }) };
  delete schema.$schema;
  return objectSchema.parse(schema);
}

/** Every procedure under `ship`, in the router's order. Built once: the router never changes while the server runs. */
export const SHIP_CALLS: readonly ShipCall[] = Object.entries(appRouter.ship).map(([name, procedure]): ShipCall => {
  const { type, inputs, meta } = procedure._def;
  // The output parser is on the procedure at runtime, though tRPC's types leave it out.
  const output = 'output' in procedure._def ? procedure._def.output : undefined;
  return {
    name,
    path: `ship.${name}`,
    type,
    description: metaSchema.parse(meta).description,
    credential: name === 'register' ? 'secret' : 'crewToken',
    input: jsonSchemaOf(inputs[0], 'input'),
    output: jsonSchemaOf(output, 'output'),
  };
});

/** What a caller learns of a call that did not succeed: the code, its HTTP status and a message it may read. */
export interface ShipCallRefusal {
  code: TRPC_ERROR_CODE_KEY;
  httpStatus: number;
  message: string;
  /** Only for a server failure: the request's id, under which the server log holds the whole failure. */
  requestId?: string;
}

export type ShipCallResult =
  | { isOk: true; output: unknown }
  | {
      isOk: false;
      refusal: ShipCallRefusal;
      /** The whole error of a server failure, for the log only; never shown to the caller. */
      failure?: TRPCError;
    };

/**
 * What a caller reads of an error. A refusal keeps its code and message, an
 * input that does not parse reads as one line per problem and field, and a
 * server failure says only that it failed, with the request's id, as the
 * router's error formatter does for `/trpc`.
 */
function refusalOf(error: TRPCError, requestId: string): ShipCallRefusal {
  const httpStatus = getHTTPStatusCodeFromError(error);
  if (error.code === 'INTERNAL_SERVER_ERROR') {
    return { code: error.code, httpStatus, message: INTERNAL_ERROR_MESSAGE, requestId };
  }
  const message = error.cause instanceof z.ZodError ? z.prettifyError(error.cause) : error.message;
  return { code: error.code, httpStatus, message };
}

/**
 * Calls the procedure with the raw input, as the context's caller. The
 * credentials in the context are the door's: a bearer crew token for REST, the
 * `crewToken` argument for MCP.
 */
export async function callShip(call: ShipCall, request: { ctx: Context; input: unknown }): Promise<ShipCallResult> {
  const { ctx, input } = request;
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
    const refusal = refusalOf(error, ctx.requestId);
    return error.code === 'INTERNAL_SERVER_ERROR' ? { isOk: false, refusal, failure: error } : { isOk: false, refusal };
  }
}
