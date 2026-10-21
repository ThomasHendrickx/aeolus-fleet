import { createServer, type Server } from 'node:http';

import { idSchema, SCOPES, type DeliveryId, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { createTRPCClient, httpLink, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import { UNDELIVERABLE_AT_ATTEMPT } from '../src/domain/messaging/delivery.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import type { AppRouter } from '../src/index.js';
import { createTestIssuer, type TestIssuer } from '../src/testing/account-token-issuer.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { secretOf } from '../src/testing/fleet.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { FLEET_URL } from './support/core-fixtures.js';
import { aCrewSettings } from './support/crew-fixtures.js';
import { createTestClock } from './support/postgres-core.js';

// The console's actions on ships and deliveries for an account signed in as
// itself (accounts design, F1, F3): each is taken by its token cookie from
// the console's origin, as any actor's, with the account as the actor of
// what it writes.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const CONSOLE = new URL(FLEET_URL).origin;
const ACCOUNT_ACTOR = { actorKind: 'account', actorAccountId: 'acc-mathilde' };
const clock = createTestClock('2026-10-21T10:00:00.000Z');

let keys: Server;
let issuer: TestIssuer;
let database: PrismaClient;
let useCases: UseCases;
let fleetServer: FastifyInstance;
let address: string;
let fleetId: FleetId;
let argo: ShipCaller;
let mathilde: TRPCClient<AppRouter>;

function seconds(at: Date): number {
  return Math.floor(at.getTime() / 1000);
}

/** The browser of Mathilde, signed in as her account with what the console's actions need. */
async function signedIn(): Promise<TRPCClient<AppRouter>> {
  const now = seconds(clock.now());
  const token = issuer.sign({ iss: issuer.issuer, aud: fleetId, sub: 'acc-mathilde', org: 'org-acme', scope: 'fleet:read fleet:manage messages:resend crew:assign', group: [], iat: now, exp: now + 600 });
  const answer = await fetch(`${address}/trpc/console.presentAccountToken`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  const cookie = answer.headers.get('set-cookie')?.split(';')[0];
  if (!answer.ok || cookie === undefined) {
    throw new Error(`presenting the token set no cookie: ${String(answer.status)}`);
  }
  return createTRPCClient<AppRouter>({ links: [httpLink({ url: `${address}/trpc`, headers: { cookie, origin: CONSOLE } })] });
}

async function commissioned(name: string, type = 'reviewer'): Promise<ShipId> {
  return unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type })).shipId;
}

async function crewed(name: string): Promise<Crew> {
  const ship = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId: ship.shipId, secret: secretOf(ship.secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return unwrap(await useCases.authenticate.byCrewToken(crewToken));
}

async function deliveryOf(messageId: MessageId): Promise<DeliveryId> {
  const { id } = await database.delivery.findFirstOrThrow({ where: { messageId } });
  return idSchema('delivery').parse(id);
}

/** A message from argo the crew receives five times without acknowledging it: undeliverable. One more waits behind it. */
async function undeliverableTo(crew: Crew): Promise<DeliveryId> {
  const send = async (payload: string) =>
    unwrap(await useCases.sendMessage(argo, { selector: { kind: 'ship', shipId: crew.shipId }, payload, contentType: 'text/plain', idempotencyKey: newKey() })).messageId;
  const messageId = await send('Run the e2e suite');
  const next = await send('Then the unit tests');
  for (let claim = 1; claim <= UNDELIVERABLE_AT_ATTEMPT; claim += 1) {
    clock.advance(1_000);
    unwrap(await useCases.receiveDeliveries(crew, {}));
  }
  unwrap(await useCases.acknowledgeDelivery(crew, { deliveryId: await deliveryOf(next) }));
  return deliveryOf(messageId);
}

async function lastEventOf(type: string) {
  return database.event.findFirstOrThrow({ where: { fleetId, type }, orderBy: { id: 'desc' }, select: { actorKind: true, actorAccountId: true } });
}

beforeAll(async () => {
  keys = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(issuer.keySet()));
  });
  await new Promise<void>((listening) => keys.listen(0, '127.0.0.1', listening));
  const bound = keys.address();
  if (bound === null || typeof bound === 'string') {
    throw new Error('the key set server listens on no port');
  }
  issuer = createTestIssuer(`http://127.0.0.1:${String(bound.port)}`);

  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock });
  fleetServer = createApp({ databaseUrl, publicUrl: FLEET_URL, logger: false, clock, installationToken: INSTALLATION_TOKEN, accountTokenIssuer: issuer.issuer });
  address = await fleetServer.listen({ host: '127.0.0.1', port: 0 });

  const installation = createTRPCClient<AppRouter>({ links: [httpLink({ url: `${address}/trpc`, headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } })] }).installation;
  const created = await installation.fleets.create.mutate({ requestId: newKey(), name: 'acme', operatorEmail: 'acme@example.com' });
  ({ fleetId } = created);
  argo = { shipId: created.operatorShipId, fleetId, kind: 'operator', scopes: [...SCOPES] };
  mathilde = await signedIn();
});

afterAll(async () => {
  await fleetServer.close();
  await database.$disconnect();
  keys.close();
});

describe('an account signed in to the console, acting on ships', () => {
  it("pings a crewed ship: argo's ping, the event naming the account", async () => {
    const scout = await crewed('scout');

    const { messageId, isNew } = await mathilde.fleet.ping.mutate({ shipId: scout.shipId });

    expect(isNew).toBe(true);
    await expect(database.message.findFirstOrThrow({ where: { id: messageId }, select: { senderShipId: true } })).resolves.toEqual({ senderShipId: argo.shipId });
    await expect(lastEventOf('MessageAccepted')).resolves.toEqual(ACCOUNT_ACTOR);
  });

  it('gives a crewed ship a new crew, the release naming the account', async () => {
    const lookout = await crewed('lookout');

    const prompt = await mathilde.fleet.recrew.mutate({ shipId: lookout.shipId });

    expect(prompt.shipId).toBe(lookout.shipId);
    await expect(lastEventOf('LeaseRevoked')).resolves.toEqual(ACCOUNT_ACTOR);
  });

  it('asks for crew, assigns it, explains another and removes a request, each event naming the account', async () => {
    const trierarch = await commissioned('mac-mini', 'trierarch');
    const keeper = await commissioned('keeper');
    const planner = await commissioned('planner');

    await mathilde.fleet.crewRequest.mutate({ shipId: keeper, settings: aCrewSettings({ harness: 'claude-code' }) });
    await mathilde.fleet.assignCrew.mutate({ shipId: keeper, trierarchShipId: trierarch });
    await mathilde.fleet.crewRequest.mutate({ shipId: planner, settings: aCrewSettings({ harness: 'codex' }) });
    await mathilde.fleet.explainCrewRequest.mutate({ shipId: planner, reason: 'No trierarch runs codex' });
    await mathilde.fleet.removeCrewRequest.mutate({ shipId: planner });

    for (const type of ['CrewRequested', 'CrewAssigned', 'CrewRequestExplained', 'CrewRequestRemoved']) {
      await expect(lastEventOf(type)).resolves.toEqual(ACCOUNT_ACTOR);
    }
  });
});

describe('an account signed in to the console, acting on deliveries', () => {
  it('dismisses an undeliverable delivery, the event naming the account', async () => {
    const deliveryId = await undeliverableTo(await crewed('tester'));

    await mathilde.fleet.dismiss.mutate({ deliveryId });

    await expect(database.delivery.findFirstOrThrow({ where: { id: deliveryId }, select: { state: true } })).resolves.toEqual({ state: 'dismissed' });
    await expect(lastEventOf('DeliveryDismissed')).resolves.toEqual(ACCOUNT_ACTOR);
  });

  it('resends an undeliverable delivery from its original sender, the new message naming the account', async () => {
    const deliveryId = await undeliverableTo(await crewed('builder'));

    const { messageId } = await mathilde.fleet.resend.mutate({ deliveryId });

    await expect(database.message.findFirstOrThrow({ where: { id: messageId }, select: { senderShipId: true } })).resolves.toEqual({ senderShipId: argo.shipId });
    await expect(lastEventOf('MessageAccepted')).resolves.toEqual(ACCOUNT_ACTOR);
  });
});
