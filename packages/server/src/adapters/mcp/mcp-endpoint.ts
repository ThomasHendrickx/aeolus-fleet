/**
 * `/mcp`: the ship contract as a remote MCP server, over streamable HTTP with
 * the official SDK (ADR 0004). One tool per ship procedure, listed and called
 * through the router (see trpc/ship-contract.ts); nothing here decides
 * anything about a ship.
 *
 * The connection carries no ship (ADR 0015): many conversations share one
 * MCP connection, each crewing its own ship. So every tool but `register`
 * takes the crew token as its `crewToken` argument, and no header of the
 * connection is ever read as a credential. The endpoint is stateless: a fresh
 * server answers each HTTP request, and nothing is kept between them.
 */
import {
  createMcpHandler,
  McpServer,
  type CallToolRequestParams,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/server';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Context, RequestCredentials } from '../trpc/context.js';
import {
  callShip,
  refusalBody,
  SHIP_CALLS,
  unexpectedFailure,
  type ShipCall,
  type ShipCallRefusal,
} from '../trpc/ship-contract.js';
import { SHIP_PROTOCOL } from '../trpc/ship-protocol.js';
import { MCP_PATH } from './mcp-url.js';

/** How the server names itself to MCP clients. Its version is the ship contract's, as in `/api/v1`. */
const SERVER_INFO = { name: 'aeolus-fleet', version: '1' };

const CREW_TOKEN_PROPERTY = {
  type: 'string',
  description: 'The crew token register gave you (aeolus_ct_v1_...): it says which ship you crew.',
};

/** The one credential a tool takes as an argument. Whether it is a valid one is for the router to judge. */
const crewTokenArgument = z.string();

/** A ship call as an MCP tool: every one but `register` asks for the crew token first. */
function toolOf(call: ShipCall): Tool {
  const input = call.input?.schema ?? { type: 'object', properties: {}, required: [] };
  const inputSchema =
    call.credential === 'crewToken'
      ? {
          ...input,
          properties: { crewToken: CREW_TOKEN_PROPERTY, ...input.properties },
          required: ['crewToken', ...input.required],
        }
      : input;
  return { name: call.name, description: call.description, inputSchema, outputSchema: call.output };
}

const TOOLS: Tool[] = SHIP_CALLS.map(toolOf);

/** A tool error the model reads: the code first, so it can tell a refusal from a failure. */
function refusalResult(refusal: Pick<ShipCallRefusal, 'code' | 'message' | 'requestId'>): CallToolResult {
  const { code, message, requestId } = refusal;
  const text = requestId === undefined ? `${code}: ${message}` : `${code}: ${message} (request id ${requestId})`;
  return { content: [{ type: 'text', text }], isError: true };
}

export interface McpEndpointOptions {
  /** The context of one call, for this request, with the credentials the tool call carries. */
  contextFor: (request: FastifyRequest, credentials: RequestCredentials) => Context;
}

/** One tool call, as a call through the router with the crew token its arguments carry. */
async function callTool(
  params: CallToolRequestParams,
  at: { request: FastifyRequest; options: McpEndpointOptions },
): Promise<CallToolResult> {
  const { request, options } = at;
  const call = SHIP_CALLS.find((candidate) => candidate.name === params.name);
  if (!call) {
    const names = SHIP_CALLS.map((known) => known.name).join(', ');
    return refusalResult({
      code: 'NOT_FOUND',
      message: `There is no tool named ${params.name}. The ship tools are ${names}.`,
    });
  }

  const args = params.arguments ?? {};
  const { crewToken, ...input } = args;
  const result = await callShip(
    call,
    call.credential === 'crewToken'
      ? { ctx: options.contextFor(request, { bearer: crewTokenArgument.safeParse(crewToken).data }), input, log: request.log }
      : { ctx: options.contextFor(request, {}), input: args, log: request.log },
  );

  if (!result.isOk) {
    return refusalResult(result.refusal);
  }
  const structuredContent = z.record(z.string(), z.unknown()).parse(result.output);
  return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
}

/**
 * The MCP server answering one HTTP request: the ship tools, each a call
 * through the router, and the ship protocol as its instructions, which a
 * client reads when it connects. It answers `tools/list` and `tools/call`
 * itself, at the protocol level, rather than registering each tool: a
 * registered tool's arguments are validated by the SDK before its handler
 * runs, and the router must be the one to judge them, so a refusal reads with
 * its own code.
 */
function shipToolServer(request: FastifyRequest, options: McpEndpointOptions): McpServer {
  const mcp = new McpServer(SERVER_INFO, { capabilities: { tools: {} }, instructions: SHIP_PROTOCOL });

  mcp.server.setRequestHandler('tools/list', () => ({ tools: TOOLS }));

  // A failure here would otherwise reach the client as a protocol error in its own words.
  mcp.server.setRequestHandler('tools/call', async ({ params }) => {
    try {
      return await callTool(params, { request, options });
    } catch (thrown) {
      return refusalResult(unexpectedFailure(thrown, { log: request.log, requestId: request.id }));
    }
  });

  return mcp;
}

/** The request as the SDK's web-standard handler takes it. Fastify has read the JSON body already. */
function webRequestOf(request: FastifyRequest): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    for (const each of Array.isArray(value) ? value : [value]) {
      if (each !== undefined) {
        headers.append(name, each);
      }
    }
  }
  return new Request(new URL(request.url, `${request.protocol}://${request.host}`), { method: request.method, headers });
}

/** Mounts `/mcp` on the HTTP server. */
export function registerMcpEndpoint(server: FastifyInstance, options: McpEndpointOptions): void {
  server.all(MCP_PATH, async (request, reply) => {
    try {
      // A handler per request, so each tool call knows the request it came
      // with: its client address for the register limit, its id for the log.
      const handler = createMcpHandler(() => shipToolServer(request, options));
      return await handler.fetch(webRequestOf(request), { parsedBody: request.body });
    } catch (thrown) {
      const refusal = unexpectedFailure(thrown, { log: request.log, requestId: request.id });
      return await reply.code(refusal.httpStatus).send(refusalBody(refusal));
    }
  });
}
