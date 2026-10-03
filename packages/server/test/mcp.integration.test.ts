import type { ShipId } from '@aeolus-fleet/common';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { Caller } from '../src/core/shared/caller.js';
import { createUseCases } from '../src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretIn } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// The ship contract as MCP tools, from the official MCP client over HTTP to
// Postgres and back. A conversation registers with its ship's id and secret
// and passes the crew token to every other tool: the connection carries no
// ship (ADR 0015), so conversations sharing it crew different ships.

/** How long a receive waits on an empty inbox at this server: short, so an empty receive costs little. */
const RECEIVE_WAIT_MS = 500;

/** The protocol revisions the SDK client speaks: the 2025-era handshake by default, 2026-07-28 when it negotiates. */
const ERAS = ['2025 handshake', '2026-07-28 negotiation'] as const;
type Era = (typeof ERAS)[number];

let databaseUrl: string;
let database: PrismaClient;
let argo: Caller;
let server: FastifyInstance;
let address: string;
let clients: Client[] = [];
let shipCount = 0;

beforeAll(async () => {
  databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  argo = operatorCaller(
    unwrap(await createUseCases({ prisma: database, fleetUrl: FLEET_URL }).initialiseFleet({ name: 'home fleet', ...OPERATOR })),
  );
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, logger: false, receiveWaitMs: RECEIVE_WAIT_MS });
  address = await server.listen({ host: '127.0.0.1', port: 0 });
});

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()));
  clients = [];
});

afterAll(async () => {
  await server.close();
  await database.$disconnect();
});

/** A new MCP connection to the fleet, as a Claude Code session configured with /mcp holds one. */
async function connect(era: Era = '2025 handshake'): Promise<Client> {
  const client = new Client(
    { name: 'ship-session', version: '1.0.0' },
    era === '2026-07-28 negotiation' ? { versionNegotiation: { mode: 'auto' } } : {},
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`)));
  clients.push(client);
  return client;
}

/** A new ship commissioned by argo with fleet scopes: its id, name and secret. */
async function commissionedWithFleetScopes(
  fleetScopes: ('fleet:read' | 'fleet:manage')[],
): Promise<{ shipId: ShipId; name: string; secret: string }> {
  shipCount += 1;
  const name = `manager-${shipCount}`;
  const { shipId, prompt } = unwrap(
    await createUseCases({ prisma: database, fleetUrl: FLEET_URL }).commissionShip(argo, { idempotencyKey: newKey(), name, type: 'squadron', fleetScopes }),
  );
  return { shipId, name, secret: secretIn(prompt) };
}

/** A new agent ship, commissioned by argo: its id, name and the secret its starting prompt holds. */
async function commissioned(): Promise<{ shipId: ShipId; name: string; secret: string }> {
  shipCount += 1;
  const name = `ship-${shipCount}`;
  const { shipId, prompt } = unwrap(
    await createUseCases({ prisma: database, fleetUrl: FLEET_URL }).commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }),
  );
  return { shipId, name, secret: secretIn(prompt) };
}

const toolResultSchema = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
});

/** A tool with what it answers, and the arguments to call it with. */
interface ToolCall<T> {
  tool: { name: string; answers: z.ZodType<T> };
  arguments: Record<string, unknown>;
}

/**
 * Calls a tool and parses what it answers: its structured content, or the
 * JSON text of a tool that answers a list. Fails with the tool's own text when
 * it answers with an error.
 */
async function call<T>(client: Client, { tool, arguments: args }: ToolCall<T>): Promise<T> {
  const result = toolResultSchema.parse(await client.callTool({ name: tool.name, arguments: args }));
  if (result.isError) {
    throw new Error(`${tool.name} answered an error: ${result.content.map((block) => block.text).join('\n')}`);
  }
  const text = result.content.map((block) => block.text).join('');
  return tool.answers.parse(result.structuredContent ?? JSON.parse(text));
}

/** The text a tool answers with an error. Fails when the call succeeds. */
async function refusalOf(client: Client, request: { name: string; arguments: Record<string, unknown> }): Promise<string> {
  const result = toolResultSchema.parse(await client.callTool(request));
  expect(result.isError, `${request.name} succeeded`).toBe(true);
  return result.content.map((block) => block.text).join('\n');
}

const tools = {
  register: { name: 'register', answers: z.object({ crewToken: z.string() }) },
  whoami: { name: 'whoami', answers: z.object({ shipId: z.string(), name: z.string(), type: z.string() }) },
  send: { name: 'send', answers: z.object({ messageId: z.string() }) },
  receive: {
    name: 'receive',
    answers: z.object({
      deliveries: z.array(
        z.object({
          deliveryId: z.string(),
          messageId: z.string(),
          senderShipId: z.string(),
          senderName: z.string(),
          payload: z.string(),
          inReplyTo: z.string().nullable(),
        }),
      ),
    }),
  },
  ack: { name: 'ack', answers: z.strictObject({}) },
  pong: { name: 'pong', answers: z.strictObject({}) },
  deregister: { name: 'deregister', answers: z.strictObject({}) },
};

/** Claims the ship through the register tool, from a DEVICE. Returns the crew token. */
async function register(client: Client, ship: { shipId: ShipId; secret: string }): Promise<string> {
  const { crewToken } = await call(client, { tool: tools.register, arguments: { ...ship, location: { kind: 'DEVICE' }, harness: 'claude-code' } });
  return crewToken;
}

describe('the ship tools at /mcp', () => {
  it.each(ERAS)('register, send, receive, ack and deregister: two ships exchange a message and its answer (%s)', async (era) => {
    const harbour = await commissioned();
    const mooring = await commissioned();
    const harbourSession = await connect(era);
    const mooringSession = await connect(era);
    const harbourToken = await register(harbourSession, harbour);
    const mooringToken = await register(mooringSession, mooring);

    const { messageId } = await call(harbourSession, {
      tool: tools.send,
      arguments: {
        crewToken: harbourToken,
        model: 'claude-opus-5-5',
        selector: { kind: 'ship', name: mooring.name },
        payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/32',
        idempotencyKey: freshKey(),
      },
    });
    const received = await call(mooringSession, { tool: tools.receive, arguments: { crewToken: mooringToken } });
    const [delivery] = received.deliveries;
    if (!delivery) {
      throw new Error('mooring received nothing');
    }
    await call(mooringSession, { tool: tools.ack, arguments: { crewToken: mooringToken, deliveryId: delivery.deliveryId } });
    const { messageId: answerId } = await call(mooringSession, {
      tool: tools.send,
      arguments: {
        crewToken: mooringToken,
        model: 'claude-opus-5-5',
        selector: { kind: 'ship', name: delivery.senderName },
        payload: 'Reviewed: approved',
        idempotencyKey: freshKey(),
        inReplyTo: delivery.messageId,
      },
    });
    const answered = await call(harbourSession, { tool: tools.receive, arguments: { crewToken: harbourToken } });
    const [answer] = answered.deliveries;
    await call(harbourSession, { tool: tools.ack, arguments: { crewToken: harbourToken, deliveryId: answer?.deliveryId } });
    await call(mooringSession, { tool: tools.deregister, arguments: { crewToken: mooringToken } });

    expect(delivery).toMatchObject({ messageId, senderShipId: harbour.shipId, senderName: harbour.name });
    expect(answer).toMatchObject({ messageId: answerId, senderName: mooring.name, inReplyTo: messageId });
    await expect(call(harbourSession, { tool: tools.receive, arguments: { crewToken: harbourToken } })).resolves.toEqual({
      deliveries: [],
    });
    await expect(
      refusalOf(mooringSession, { name: 'whoami', arguments: { crewToken: mooringToken } }),
    ).resolves.toBe('LEASE_ENDED: This ship was released; this session no longer crews it.');
  });

  it('pong: a ship answers the ping argo sent it, and the ping is acknowledged', async () => {
    const skiff = await commissioned();
    const session = await connect();
    const crewToken = await register(session, skiff);
    const { messageId } = unwrap(
      await createUseCases({ prisma: database, fleetUrl: FLEET_URL }).pingShip(argo, { shipId: skiff.shipId }),
    );
    const [ping] = (await call(session, { tool: tools.receive, arguments: { crewToken } })).deliveries;

    await call(session, { tool: tools.pong, arguments: { crewToken, deliveryId: ping?.deliveryId } });

    expect(ping).toMatchObject({ messageId });
    await expect(database.delivery.findFirstOrThrow({ where: { messageId } })).resolves.toMatchObject({
      state: 'acknowledged',
    });
  });

  it('lets a ship with fleet:read and fleet:manage list the fleet and commission a ship through the fleet tools', async () => {
    const manager = await commissionedWithFleetScopes(['fleet:read', 'fleet:manage']);
    const session = await connect();
    const crewToken = await register(session, manager);

    const listed = await call(session, {
      tool: { name: 'fleet_list', answers: z.array(z.object({ name: z.string() })) },
      arguments: { crewToken },
    });
    const { shipId } = await call(session, {
      tool: { name: 'fleet_commission', answers: z.object({ shipId: z.string() }) },
      arguments: { crewToken, name: `${manager.name}-member`, type: 'squadron', idempotencyKey: 'commission-member' },
    });

    expect(listed.map((ship) => ship.name)).toContain(manager.name);
    expect(shipId).toMatch(/^shp_/);
  });

  it('lets a ship with fleet:read follow the fleet through fleet_follow', async () => {
    const reader = await commissionedWithFleetScopes(['fleet:read']);
    const session = await connect();
    const crewToken = await register(session, reader);
    const followed = { name: 'fleet_follow', answers: z.object({ events: z.array(z.object({ type: z.string() })), lastSeq: z.number() }) };
    const { lastSeq } = await call(session, { tool: followed, arguments: { crewToken } });
    await commissioned();

    const { events } = await call(session, { tool: followed, arguments: { crewToken, afterSeq: lastSeq } });

    expect(events.map((event) => event.type)).toEqual(['ShipCommissioned', 'StartingPromptIssued']);
  });

  it('refuses a fleet tool to a ship without its scope, with the code first', async () => {
    const agent = await commissioned();
    const session = await connect();
    const crewToken = await register(session, agent);

    await expect(refusalOf(session, { name: 'fleet_list', arguments: { crewToken } })).resolves.toBe(
      'FORBIDDEN: This call needs the fleet:read scope',
    );
  });

  it('report: a crew says it is blocked, shown with its ship', async () => {
    const skiff = await commissioned();
    const session = await connect();
    const crewToken = await register(session, skiff);

    await call(session, { tool: { name: 'report', answers: z.strictObject({}) }, arguments: { crewToken, state: 'blocked', note: 'waiting for review' } });

    const listed = await createUseCases({ prisma: database, fleetUrl: FLEET_URL }).listFleet(argo);
    expect(listed.find((ship) => ship.id === skiff.shipId)?.report).toMatchObject({ state: 'blocked', note: 'waiting for review' });
  });

  it('crews two different ships from two conversations on one connection, each by its own crew token', async () => {
    const scout = await commissioned();
    const lookout = await commissioned();
    const connection = await connect();

    const scoutToken = await register(connection, scout);
    const lookoutToken = await register(connection, lookout);
    await call(connection, {
      tool: tools.send,
      arguments: {
        crewToken: scoutToken,
        model: 'claude-opus-5-5',
        selector: { kind: 'ship', name: lookout.name },
        payload: 'Land ho',
        idempotencyKey: freshKey(),
      },
    });

    await expect(call(connection, { tool: tools.whoami, arguments: { crewToken: scoutToken } })).resolves.toMatchObject({
      shipId: scout.shipId,
      name: scout.name,
    });
    await expect(call(connection, { tool: tools.whoami, arguments: { crewToken: lookoutToken } })).resolves.toMatchObject({
      shipId: lookout.shipId,
      name: lookout.name,
    });
    await expect(call(connection, { tool: tools.receive, arguments: { crewToken: lookoutToken } })).resolves.toMatchObject({
      deliveries: [{ payload: 'Land ho', senderShipId: scout.shipId }],
    });
    await expect(call(connection, { tool: tools.receive, arguments: { crewToken: scoutToken } })).resolves.toEqual({
      deliveries: [],
    });
  });

  it('refuses a second register of a ship a session crews, with readable text naming its code', async () => {
    const scout = await commissioned();
    await register(await connect(), scout);

    const text = await refusalOf(await connect(), {
      name: 'register',
      arguments: { shipId: scout.shipId, secret: scout.secret, location: { kind: 'CLOUD' }, harness: 'claude-code' },
    });

    expect(text).toBe(`CONFLICT: ${scout.name} is crewed: a session claims a ship only while it awaits crew`);
  });

  it('refuses a tool call without a crew token, or with one that is not valid', async () => {
    const scout = await commissioned();
    const connection = await connect();
    await register(connection, scout);
    const sending = {
      selector: { kind: 'ship', name: scout.name },
      payload: 'Anyone aboard?',
      model: 'claude-opus-5-5',
      idempotencyKey: freshKey(),
    };
    const messagesBefore = await database.message.count();

    await expect(refusalOf(connection, { name: 'send', arguments: sending })).resolves.toBe(
      'UNAUTHORIZED: Call with the crew token register gave you',
    );
    await expect(
      refusalOf(connection, { name: 'send', arguments: { ...sending, crewToken: 'aeolus_ct_v1_not-a-crew' } }),
    ).resolves.toBe('UNAUTHORIZED: Call with the crew token register gave you');
    await expect(refusalOf(connection, { name: 'receive', arguments: { crewToken: scout.secret } })).resolves.toMatch(
      /^UNAUTHORIZED: /,
    );
    await expect(database.message.count()).resolves.toBe(messagesBefore);
  });
});

let keyCount = 0;

/** A new idempotency key: every message gets its own. */
function freshKey(): string {
  keyCount += 1;
  return `key-${keyCount}`;
}
