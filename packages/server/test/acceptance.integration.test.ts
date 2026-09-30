import type { LocationInput, ShipId } from '@aeolus-fleet/common';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { Caller } from '../src/core/shared/caller.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { FLEET_URL, mcpUrlIn, OPERATOR, operatorCaller, secretIn, shipIdIn } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { unwrap } from './support/result.js';

// The v1 acceptance test (docs/architecture.md, "Testing"): two ships
// exchange messages back and forth over MCP, each session knowing only its
// starting prompt, from the official MCP client to a running server on
// Postgres. The receiver is released mid-delivery, a new crew registers with a
// new starting prompt and receives the message again, and the conversation
// goes on: nothing is lost, and the event log shows every step.

/** How long a receive waits on an empty inbox at this server: short, so a session that keeps receiving turns often. */
const RECEIVE_WAIT_MS = 1_000;
/** How many receives a waiting session makes before the test gives up on an answer. */
const RECEIVES_WHILE_WAITING = 10;

let database: PrismaClient;
let server: FastifyInstance;
/** The operator's side: argo's use cases, wired as the server wires them, with the URL the server answers on. */
let operator: UseCases;
let argo: Caller;
const clients: Client[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, logger: false, receiveWaitMs: RECEIVE_WAIT_MS });
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  operator = createUseCases({ prisma: database, fleetUrl: address });
  argo = operatorCaller(unwrap(await operator.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  await eventsSinceLastStep();
});

afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()));
  await server.close();
  await database.$disconnect();
});

/** A session crewing a ship: its connection to the fleet and the crew token register gave it. */
interface Session {
  client: Client;
  crewToken: string;
  /** The server's instructions, as the session read them when it connected. */
  instructions: string | undefined;
}

const toolResultSchema = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
});

const deliverySchema = z.object({
  deliveryId: z.string(),
  messageId: z.string(),
  senderShipId: z.string(),
  senderName: z.string(),
  payload: z.string(),
  inReplyTo: z.string().nullable(),
  attempts: z.number(),
});
type Delivery = z.infer<typeof deliverySchema>;

const answers = {
  register: z.object({ crewToken: z.string() }),
  send: z.object({ messageId: z.string() }),
  receive: z.object({ deliveries: z.array(deliverySchema) }),
  ack: z.strictObject({}),
};

/** Calls a tool and parses what it answers. Fails with the tool's own text when it answers with an error. */
async function call<T>(
  client: Client,
  request: { name: string; answers: z.ZodType<T>; arguments: object },
): Promise<T> {
  const { name } = request;
  const result = toolResultSchema.parse(await client.callTool({ name, arguments: { ...request.arguments } }));
  if (result.isError) {
    throw new Error(`${name} answered an error: ${result.content.map((block) => block.text).join('\n')}`);
  }
  return request.answers.parse(result.structuredContent);
}

/** The text a tool answers with an error. Fails when the call succeeds. */
async function refusalOf(client: Client, request: { name: string; arguments: object }): Promise<string> {
  const { name } = request;
  const result = toolResultSchema.parse(await client.callTool({ name, arguments: { ...request.arguments } }));
  expect(result.isError, `${name} succeeded`).toBe(true);
  return result.content.map((block) => block.text).join('\n');
}

/**
 * A new session given only a starting prompt: it connects to the fleet's MCP
 * URL in it and registers with the ship id and secret in it.
 */
async function sessionFrom(prompt: string, location: LocationInput): Promise<Session> {
  const client = new Client({ name: 'ship-session', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrlIn(prompt))));
  clients.push(client);
  const { crewToken } = await call(client, {
    name: 'register',
    answers: answers.register,
    arguments: { shipId: shipIdIn(prompt), secret: secretIn(prompt), location },
  });
  return { client, crewToken, instructions: client.getInstructions() };
}

let keyCount = 0;

/** Sends a message to a ship by name, as an answer when it names the message it answers. Returns the message's id. */
async function send(from: Session, message: { to: string; payload: string; inReplyTo?: string }): Promise<string> {
  keyCount += 1;
  const { messageId } = await call(from.client, {
    name: 'send',
    answers: answers.send,
    arguments: {
      crewToken: from.crewToken,
      selector: { kind: 'ship', name: message.to },
      payload: message.payload,
      idempotencyKey: `acceptance-${keyCount}`,
      ...(message.inReplyTo === undefined ? {} : { inReplyTo: message.inReplyTo }),
    },
  });
  return messageId;
}

async function receive(session: Session): Promise<Delivery[]> {
  const { deliveries } = await call(session.client, {
    name: 'receive',
    answers: answers.receive,
    arguments: { crewToken: session.crewToken },
  });
  return deliveries;
}

/** Keeps receiving while it waits for an answer, as the protocol says: the first delivery that arrives. */
async function receiveWhileWaiting(session: Session): Promise<Delivery> {
  for (let receives = 0; receives < RECEIVES_WHILE_WAITING; receives += 1) {
    const [delivery] = await receive(session);
    if (delivery) {
      return delivery;
    }
  }
  throw new Error(`Nothing arrived in ${RECEIVES_WHILE_WAITING} receives`);
}

async function ack(session: Session, delivery: Delivery): Promise<void> {
  await call(session.client, {
    name: 'ack',
    answers: answers.ack,
    arguments: { crewToken: session.crewToken, deliveryId: delivery.deliveryId },
  });
}

/** The loop of the protocol for one delivery: ack it at once, then answer its sender by name, naming its message. */
async function ackAndAnswer(session: Session, answer: { to: Delivery; payload: string }): Promise<string> {
  const { to: delivery, payload } = answer;
  await ack(session, delivery);
  return send(session, { to: delivery.senderName, payload, inReplyTo: delivery.messageId });
}

/** An event as a step shows it: its type, the ship that caused it, and the ship, message and delivery it concerns. */
interface LoggedEvent {
  type: string;
  actorShipId: string | null;
  shipId: string | null;
  messageId: string | null;
  deliveryId: string | null;
}

function logged(type: string, concerns: Partial<Omit<LoggedEvent, 'type'>>): LoggedEvent {
  return { type, actorShipId: null, shipId: null, messageId: null, deliveryId: null, ...concerns };
}

/** What an event about a delivery concerns: the delivery and its message. */
function concerning(delivery: Delivery): Pick<LoggedEvent, 'messageId' | 'deliveryId'> {
  return { messageId: delivery.messageId, deliveryId: delivery.deliveryId };
}

const seenEventIds = new Set<string>();

/**
 * The events written since the last step, in the order they were written.
 * Two id generators write events here, the server's and the operator's, whose
 * ids made in one millisecond do not sort in writing order; so each step holds
 * the events of one side only, and reads what is new rather than counting rows.
 */
async function eventsSinceLastStep(): Promise<LoggedEvent[]> {
  const events = await database.event.findMany({ orderBy: { id: 'asc' } });
  const fresh = events.filter((event) => !seenEventIds.has(event.id));
  for (const event of fresh) {
    seenEventIds.add(event.id);
  }
  return fresh.map(({ type, actorShipId, shipId, messageId, deliveryId }) => ({
    type,
    actorShipId,
    shipId,
    messageId,
    deliveryId,
  }));
}

describe('the v1 acceptance test, over MCP', () => {
  it('two ships exchange messages back and forth, each session given only its starting prompt; the receiver is released mid-delivery, a new crew receives the message again, and nothing is lost', async () => {
    const argoId = argo.shipId;

    // The operator commissions two ships, and each session gets only its starting prompt.
    const scoutShip = unwrap(await operator.commissionShip(argo, { name: 'scout', type: 'navigator' }));
    const lookoutShip = unwrap(await operator.commissionShip(argo, { name: 'lookout', type: 'reviewer' }));
    const scoutId: ShipId = scoutShip.shipId;
    const lookoutId: ShipId = lookoutShip.shipId;
    await expect(eventsSinceLastStep()).resolves.toEqual([
      logged('ShipCommissioned', { actorShipId: argoId, shipId: scoutId }),
      logged('StartingPromptIssued', { actorShipId: argoId, shipId: scoutId }),
      logged('ShipCommissioned', { actorShipId: argoId, shipId: lookoutId }),
      logged('StartingPromptIssued', { actorShipId: argoId, shipId: lookoutId }),
    ]);

    // Each session connects to the fleet its prompt names, reads the protocol, and registers.
    const scout = await sessionFrom(scoutShip.prompt, { kind: 'DEVICE' });
    const lookout = await sessionFrom(lookoutShip.prompt, { kind: 'CLOUD' });
    expect(scout.instructions).toMatch(/^Aeolus carries messages between ships\./);
    await expect(eventsSinceLastStep()).resolves.toEqual([
      logged('ShipClaimed', { actorShipId: scoutId, shipId: scoutId }),
      logged('ShipClaimed', { actorShipId: lookoutId, shipId: lookoutId }),
    ]);

    // Round one: scout asks, lookout acks at once and answers scout by name.
    const firstQuestion = await send(scout, { to: 'lookout', payload: 'Which harbour tonight?' });
    const asked = await receiveWhileWaiting(lookout);
    const firstAnswer = await ackAndAnswer(lookout, { to: asked, payload: 'Ostend, before the tide turns' });
    const answered = await receiveWhileWaiting(scout);
    await ack(scout, answered);
    expect(asked).toMatchObject({ messageId: firstQuestion, senderShipId: scoutId, senderName: 'scout', attempts: 1 });
    expect(answered).toMatchObject({
      messageId: firstAnswer,
      senderName: 'lookout',
      payload: 'Ostend, before the tide turns',
      inReplyTo: firstQuestion,
    });
    await expect(eventsSinceLastStep()).resolves.toEqual([
      logged('MessageAccepted', { actorShipId: scoutId, shipId: lookoutId, ...concerning(asked) }),
      logged('DeliveryClaimed', { actorShipId: lookoutId, shipId: lookoutId, ...concerning(asked) }),
      logged('DeliveryAcknowledged', { actorShipId: lookoutId, shipId: lookoutId, ...concerning(asked) }),
      logged('MessageAccepted', { actorShipId: lookoutId, shipId: scoutId, ...concerning(answered) }),
      logged('DeliveryClaimed', { actorShipId: scoutId, shipId: scoutId, ...concerning(answered) }),
      logged('DeliveryAcknowledged', { actorShipId: scoutId, shipId: scoutId, ...concerning(answered) }),
    ]);

    // Round two: lookout receives scout's next question, and the operator releases it before it acks.
    const secondQuestion = await send(scout, { to: 'lookout', payload: 'And the pilot?' });
    const inFlight = await receiveWhileWaiting(lookout);
    await expect(eventsSinceLastStep()).resolves.toEqual([
      logged('MessageAccepted', { actorShipId: scoutId, shipId: lookoutId, ...concerning(inFlight) }),
      logged('DeliveryClaimed', { actorShipId: lookoutId, shipId: lookoutId, ...concerning(inFlight) }),
    ]);
    unwrap(await operator.releaseShip(argo, { shipId: lookoutId }));
    await expect(
      refusalOf(lookout.client, { name: 'receive', arguments: { crewToken: lookout.crewToken } }),
    ).resolves.toMatch(/^UNAUTHORIZED: /);
    await expect(eventsSinceLastStep()).resolves.toEqual([
      logged('CredentialRevoked', { actorShipId: argoId, shipId: lookoutId }),
      logged('LeaseRevoked', { actorShipId: argoId, shipId: lookoutId }),
      logged('DeliveryReturned', { actorShipId: argoId, shipId: lookoutId, ...concerning(inFlight) }),
    ]);

    // Scout keeps receiving while it waits. The operator gets lookout a new
    // starting prompt: the old one no longer crews it, the new one does, and
    // the new crew receives the question again, acks it and answers.
    const waiting = receiveWhileWaiting(scout);
    const { prompt: newPrompt } = unwrap(await operator.getStartingPrompt(argo, { shipId: lookoutId }));
    await expect(eventsSinceLastStep()).resolves.toEqual([
      logged('StartingPromptIssued', { actorShipId: argoId, shipId: lookoutId }),
    ]);
    const staleClient = new Client({ name: 'ship-session', version: '1.0.0' });
    await staleClient.connect(new StreamableHTTPClientTransport(new URL(mcpUrlIn(lookoutShip.prompt))));
    clients.push(staleClient);
    await expect(
      refusalOf(staleClient, {
        name: 'register',
        arguments: { shipId: lookoutId, secret: secretIn(lookoutShip.prompt), location: { kind: 'CLOUD' } },
      }),
    ).resolves.toBe('UNAUTHORIZED: Wrong ship id or secret');
    const relief = await sessionFrom(newPrompt, { kind: 'SERVER' });
    const again = await receiveWhileWaiting(relief);
    const secondAnswer = await ackAndAnswer(relief, { to: again, payload: 'Aboard at dawn' });
    const answeredAgain = await waiting;
    await ack(scout, answeredAgain);
    expect(again).toMatchObject({
      deliveryId: inFlight.deliveryId,
      messageId: secondQuestion,
      senderName: 'scout',
      payload: 'And the pilot?',
      attempts: 2,
    });
    expect(answeredAgain).toMatchObject({
      messageId: secondAnswer,
      senderName: 'lookout',
      payload: 'Aboard at dawn',
      inReplyTo: secondQuestion,
    });
    await expect(eventsSinceLastStep()).resolves.toEqual([
      logged('ShipClaimed', { actorShipId: lookoutId, shipId: lookoutId }),
      logged('DeliveryClaimed', { actorShipId: lookoutId, shipId: lookoutId, ...concerning(inFlight) }),
      logged('DeliveryAcknowledged', { actorShipId: lookoutId, shipId: lookoutId, ...concerning(inFlight) }),
      logged('MessageAccepted', { actorShipId: lookoutId, shipId: scoutId, ...concerning(answeredAgain) }),
      logged('DeliveryClaimed', { actorShipId: scoutId, shipId: scoutId, ...concerning(answeredAgain) }),
      logged('DeliveryAcknowledged', { actorShipId: scoutId, shipId: scoutId, ...concerning(answeredAgain) }),
    ]);

    // Nothing is lost: every message sent reached its ship and was acknowledged, and nothing waits.
    const deliveries = await database.delivery.findMany({ orderBy: { id: 'asc' } });
    const sent = [firstQuestion, firstAnswer, secondQuestion, secondAnswer];
    expect(deliveries.map(({ messageId, state }) => ({ messageId, state }))).toEqual(
      sent.map((messageId) => ({ messageId, state: 'acknowledged' })),
    );
    await expect(receive(scout)).resolves.toEqual([]);
    await expect(receive(relief)).resolves.toEqual([]);
  });
});
