import type { FleetId } from '@aeolus-fleet/common';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  addAgentShip,
  crewShip,
  identityUseCases,
  initialiseFleet,
  messagingUseCases,
  registryUseCases,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import type { UseCases } from '../trpc/context.js';
import type { RateLimit } from '../http/rate-limiter.js';
import { buildHttpServer } from '../http/server.js';

// The ship contract as MCP tools at /mcp, through the HTTP host on the
// in-memory core: what the tools say about themselves, and how a refusal or a
// failure reads. The whole flow on Postgres is in test/mcp.integration.test.ts.

const FLEET_ORIGIN = 'https://fleet.example.com';
const SHIP_TOOLS = ['register', 'whoami', 'send', 'receive', 'ack', 'deregister'];

let core: InMemoryCore;
let fleetId: FleetId;
let server: FastifyInstance;
let address: string;
let clients: Client[];

beforeEach(async () => {
  core = createInMemoryCore('2026-09-30T12:00:00.000Z');
  ({ fleetId } = await initialiseFleet(core));
  clients = [];
});

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()));
  await server.close();
});

function useCasesOf(overrides: Partial<UseCases> = {}): UseCases {
  return {
    ...identityUseCases(core),
    ...registryUseCases(core),
    ...messagingUseCases(core),
    ping: () => Promise.resolve({ serverTime: core.clock.now(), fleetCount: 1 }),
    ...overrides,
  };
}

async function start(
  options: { useCases?: UseCases; registerRateLimit?: RateLimit; logLines?: string[] } = {},
): Promise<void> {
  const { logLines } = options;
  server = buildHttpServer({
    useCases: options.useCases ?? useCasesOf(),
    checkDatabase: () => Promise.resolve(),
    clock: core.clock,
    logger: logLines
      ? {
          level: 'error',
          stream: {
            write: (line: string) => {
              logLines.push(line);
            },
          },
        }
      : false,
    registerRateLimit: options.registerRateLimit,
    consoleOrigin: FLEET_ORIGIN,
  });
  address = await server.listen({ host: '127.0.0.1', port: 0 });
}

/** A conversation's MCP client on its own connection. Headers, if any, travel with every request of it. */
async function connect(headers: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: 'ship-session', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`), { requestInit: { headers } }));
  clients.push(client);
  return client;
}

const toolResultSchema = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
});

type ToolResult = z.infer<typeof toolResultSchema>;

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

async function callTool(client: Client, call: ToolCall): Promise<ToolResult> {
  return toolResultSchema.parse(await client.callTool(call));
}

/** The text of a tool error. Fails when the call succeeds. */
async function refusalText(client: Client, call: ToolCall): Promise<string> {
  const result = await callTool(client, call);
  expect(result.isError, `${call.name} succeeded`).toBe(true);
  return result.content.map((block) => block.text).join('\n');
}

/** A new agent ship a session crews, straight into the state: its crew token. */
function crewedShip(name?: string): string {
  const { shipId } = addAgentShip(core, { fleetId, name });
  return crewShip(core, { fleetId, shipId });
}

const toolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.string(), z.record(z.string(), z.unknown())),
    required: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({ type: z.literal('object') }),
});

async function listedTools(): Promise<z.infer<typeof toolSchema>[]> {
  const client = await connect();
  return z.array(toolSchema).parse((await client.listTools()).tools);
}

async function tool(name: string): Promise<z.infer<typeof toolSchema>> {
  const found = (await listedTools()).find((listed) => listed.name === name);
  if (!found) {
    throw new Error(`No tool named ${name}`);
  }
  return found;
}

describe('the ship tools at /mcp', () => {
  it('list one tool per ship procedure: register, whoami, send, receive, ack and deregister', async () => {
    await start();

    await expect(listedTools().then((tools) => tools.map((listed) => listed.name))).resolves.toEqual(SHIP_TOOLS);
  });

  it('ask every tool but register for the crew token', async () => {
    await start();

    const tools = await listedTools();

    for (const listed of tools.filter(({ name }) => name !== 'register')) {
      expect(listed.inputSchema.required, listed.name).toContain('crewToken');
      expect(listed.inputSchema.properties.crewToken, listed.name).toMatchObject({ type: 'string' });
    }
  });

  it('ask register for the ship id and secret from the starting prompt and the location, and never a crew token', async () => {
    await start();

    const { inputSchema } = await tool('register');

    expect(inputSchema.required).toEqual(['shipId', 'secret', 'location']);
    expect(inputSchema.properties.shipId).toMatchObject({ type: 'string', pattern: '^shp_[0-7][0-9a-hjkmnp-tv-z]{25}$' });
    expect(inputSchema.properties).not.toHaveProperty('crewToken');
  });

  it("describe send's input with the schema the router parses it with: inReplyTo a message id", async () => {
    await start();

    const { inputSchema } = await tool('send');

    expect(inputSchema.required).toEqual(['crewToken', 'selector', 'payload', 'idempotencyKey']);
    expect(Object.keys(inputSchema.properties)).toEqual([
      'crewToken',
      'selector',
      'payload',
      'contentType',
      'idempotencyKey',
      'inReplyTo',
    ]);
    expect(inputSchema.properties.inReplyTo).toMatchObject({ pattern: '^msg_[0-7][0-9a-hjkmnp-tv-z]{25}$' });
  });

  it("describe ack's input: a delivery id", async () => {
    await start();

    const { inputSchema } = await tool('ack');

    expect(inputSchema.properties.deliveryId).toMatchObject({ pattern: '^dlv_[0-7][0-9a-hjkmnp-tv-z]{25}$' });
  });

  it.each([
    ['register', [/crew token/i, /only (this )?once/i, /keep it/i]],
    ['receive', [/about 25 seconds/i, /call (it|receive) again at once/i, /ack .*right away/i, /senderName/]],
    ['send', [/senderName/, /inReplyTo/, /message id, not the delivery id/i, /idempotencyKey/, /new unique/i, /retry/i]],
    ['ack', [/right away/i, /deliveryId/]],
  ])('state the rules of %s in its description', async (name, rules) => {
    await start();

    const { description } = await tool(name);

    for (const rule of rules) {
      expect(description).toMatch(rule);
    }
  });

  it('describe every tool', async () => {
    await start();

    for (const listed of await listedTools()) {
      expect(listed.description.length, listed.name).toBeGreaterThan(40);
    }
  });
});

describe('a ship tool call', () => {
  it('answers with the output as structured content and as JSON text', async () => {
    await start();
    const agent = addAgentShip(core, { fleetId, name: 'scout' });
    const client = await connect();

    const registered = await callTool(client, {
      name: 'register',
      arguments: { shipId: agent.shipId, secret: agent.secret, location: { kind: 'CLOUD' } },
    });
    const { crewToken } = z.object({ crewToken: z.string() }).parse(registered.structuredContent);
    const whoami = await callTool(client, { name: 'whoami', arguments: { crewToken } });

    const expected = { shipId: agent.shipId, fleetId, name: 'scout', type: 'reviewer' };
    expect(whoami.structuredContent).toEqual(expected);
    expect(whoami.content.map((block): unknown => JSON.parse(block.text))).toEqual([expected]);
  });

  it('takes the crew token from its argument only: a bearer header on the connection is no crew token', async () => {
    await start();
    const crewToken = crewedShip();
    const client = await connect({ authorization: `Bearer ${crewToken}` });

    await expect(refusalText(client, { name: 'whoami', arguments: {} })).resolves.toBe(
      'UNAUTHORIZED: Call with the crew token register gave you',
    );
  });

  it.each([
    ['whoami', {}],
    ['send', { selector: { kind: 'ship', name: 'scout' }, payload: 'Anyone aboard?', idempotencyKey: 'key-1' }],
    ['receive', {}],
  ])('refuses %s without a crew token or with a wrong one, naming only the crew token: a ship has no console to sign in to', async (name, args) => {
    await start();
    const client = await connect();

    await expect(refusalText(client, { name, arguments: args })).resolves.toBe(
      'UNAUTHORIZED: Call with the crew token register gave you',
    );
    await expect(refusalText(client, { name, arguments: { ...args, crewToken: 'aeolus_ct_v1_wrong' } })).resolves.toBe(
      'UNAUTHORIZED: Call with the crew token register gave you',
    );
  });

  it('refuses input that does not parse as a bad request, naming the field and what it must be', async () => {
    await start();
    const crewToken = crewedShip();
    const client = await connect();

    const text = await refusalText(client, { name: 'ack', arguments: { crewToken, deliveryId: core.ids('message') } });

    expect(text).toMatch(/^BAD_REQUEST: /);
    expect(text).toContain('must be a delivery id (dlv_...)');
    expect(text).toContain('deliveryId');
  });

  it('refuses a text input holding U+0000 as a bad request naming the field, and sends nothing', async () => {
    await start();
    const crewToken = crewedShip('scout');
    const client = await connect();

    const text = await refusalText(client, {
      name: 'send',
      arguments: {
        crewToken,
        selector: { kind: 'ship', name: 'scout' },
        payload: 'before\u0000after',
        idempotencyKey: 'key-1',
      },
    });

    expect(text).toBe('BAD_REQUEST: The input field payload cannot hold the character U+0000 (NUL)');
    expect(core.state.messages).toEqual([]);
  });

  it('refuses a tool that does not exist, naming the ship tools', async () => {
    await start();
    const client = await connect();

    await expect(refusalText(client, { name: 'retire', arguments: {} })).resolves.toBe(
      `NOT_FOUND: There is no tool named retire. The ship tools are ${SHIP_TOOLS.join(', ')}.`,
    );
  });

  it('counts a failed register against the client address, in one budget with /trpc', async () => {
    await start({ registerRateLimit: { limit: 2, windowMs: 60_000 } });
    const agent = addAgentShip(core, { fleetId });
    const client = await connect();
    const aWrongClaim = { shipId: core.ids('ship'), secret: 'aeolus_sk_v1_wrong', location: { kind: 'DEVICE' } };

    const overTrpc = await fetch(`${address}/trpc/ship.register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(aWrongClaim),
    });
    const overMcp = await refusalText(client, { name: 'register', arguments: aWrongClaim });
    const limited = await refusalText(client, {
      name: 'register',
      arguments: { shipId: agent.shipId, secret: agent.secret, location: { kind: 'DEVICE' } },
    });

    expect(overTrpc.status).toBe(401);
    expect(overMcp).toBe('UNAUTHORIZED: Wrong ship id or secret');
    expect(limited).toBe('TOO_MANY_REQUESTS: Too many failed register attempts. Wait a minute.');
    expect(core.state.leases.filter((lease) => lease.shipId === agent.shipId)).toEqual([]);
  });

  it("answers a server failure with a generic message and the request's id, and logs the whole failure under that id", async () => {
    const logLines: string[] = [];
    await start({
      useCases: useCasesOf({ whoami: () => Promise.reject(new Error('database unreachable')) }),
      logLines,
    });
    const crewToken = crewedShip();
    const client = await connect();

    const text = await refusalText(client, { name: 'whoami', arguments: { crewToken } });

    const requestId = /^INTERNAL_SERVER_ERROR: Internal error \(request id (\S+)\)$/.exec(text)?.[1];
    expect(requestId).toBeDefined();
    const [logged, ...more] = logLines.map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)));
    expect(more).toEqual([]);
    expect(logged).toMatchObject({
      msg: 'procedure failed',
      reqId: requestId,
      path: 'ship.whoami',
      reason: 'database unreachable',
    });
    expect(logged?.stack).toMatch(/^Error: database unreachable\n\s+at \S/);
  });
});
