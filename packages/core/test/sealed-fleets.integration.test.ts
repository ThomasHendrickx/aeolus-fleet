import { CreateKeyCommand, DisableKeyCommand, EnableKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { FLEET_HEADER, idSchema, MEETING_ADDED_CONTENT_TYPE, PING_CONTENT_TYPE, SCOPES, WITHDRAWAL_CONTENT_TYPE, type DeliveryId, type FleetId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink, TRPCClientError, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createAwsKmsKeyVault } from '../src/adapters/kms/aws-kms-key-vault.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { KeyVault } from '../src/domain/messaging/key-vault.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import type { AppRouter } from '../src/index.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { FLEET_URL, secretOf } from '../src/testing/fleet.js';
import { newKey } from '../src/testing/keys.js';
import { refusalOf, unwrap } from '../src/testing/result.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { startKmsKeyPolicy, type KmsKeyPolicy } from './support/kms-key-policy.js';
import { startLocalStack, type StartedLocalStack } from './support/localstack.js';
import { createTestClock } from './support/postgres-core.js';
import { PING_PAYLOAD } from '../src/domain/messaging/ping-ship.js';
import { DATA_KEY_CACHE_MS } from '../src/domain/messaging/data-keys.js';

// Sealed fleets (decision 0068) from the installation's call to Postgres and
// a LocalStack KMS. LocalStack without a licence keeps no key policy, so the
// key policy proxy in front of it grants a key for one fleet's encryption
// context alone, or refuses the installation its key, as AWS KMS would.

const REGION = 'eu-west-1';
const CREDENTIALS = { accessKeyId: 'test', secretAccessKey: 'test' };
const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const PAYLOAD = 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/1373, before 5 € lunch';
const QUESTION_ID = '0f8e2c1a-5b7d-4e3f-9a6b-2c4d8e1f0a3b';
const clock = createTestClock('2026-10-29T12:00:00.000Z');

let localStack: StartedLocalStack;
let policy: KmsKeyPolicy;
let company: KMSClient;
let keyVault: KeyVault;
let databaseUrl: string;
let prisma: PrismaClient;
let useCases: UseCases;
let server: FastifyInstance;
let address: string;

beforeAll(async () => {
  localStack = await startLocalStack();
  policy = await startKmsKeyPolicy(localStack.kmsEndpoint);
  company = new KMSClient({ endpoint: localStack.kmsEndpoint, region: REGION, credentials: CREDENTIALS });
  keyVault = createAwsKmsKeyVault({ region: REGION, endpoint: policy.endpoint, credentials: CREDENTIALS });
  databaseUrl = await createMigratedDatabase();
  prisma = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma, clock, keyVault, receiveWaitMs: 0 });
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, clock, logger: false, installationToken: INSTALLATION_TOKEN, keyVault });
  address = await server.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
  company.destroy();
  await policy.close();
  await localStack.stop();
});

function client(headers: Record<string, string>): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${address}/trpc`, headers })] });
}

/** The installation acting in the fleet (decision 0057). */
function installationIn(fleetId: FleetId): TRPCClient<AppRouter> {
  return client({ 'x-aeolus-installation-token': INSTALLATION_TOKEN, [FLEET_HEADER]: fleetId });
}

interface HostedFleet {
  fleetId: FleetId;
  argo: ShipCaller;
}

async function aHostedFleet(): Promise<HostedFleet> {
  const { fleetId, operatorShipId } = unwrap(await useCases.createFleet({ requestId: newKey(), name: 'acme', operatorEmail: `${newKey()}@example.com` }));
  return { fleetId, argo: { shipId: operatorShipId, fleetId, kind: 'operator', scopes: [...SCOPES] } };
}

async function aCompanyKey(): Promise<string> {
  const created = await company.send(new CreateKeyCommand({ Description: 'a company key' }));
  const arn = created.KeyMetadata?.Arn;
  if (arn === undefined) {
    throw new Error('LocalStack made a key without an ARN.');
  }
  return arn;
}

/** A company key whose policy grants the installation for this fleet's id alone (B3). */
async function aKeyBoundTo(fleetId: FleetId): Promise<string> {
  const companyKey = await aCompanyKey();
  policy.bindToFleet(companyKey, fleetId);
  return companyKey;
}

/** A reviewer commissioned by argo and claimed with its secret: its crew token, and its crew as the token makes it. */
async function aClaimedReviewer(fleet: HostedFleet, name: string): Promise<{ crewToken: string; crew: Crew }> {
  const { shipId, secret } = unwrap(await useCases.commissionShip(fleet.argo, { idempotencyKey: newKey(), name, type: 'reviewer' }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return { crewToken, crew: unwrap(await useCases.authenticate.byCrewToken(crewToken)) };
}

async function aCrewedReviewer(fleet: HostedFleet, name: string): Promise<Crew> {
  return (await aClaimedReviewer(fleet, name)).crew;
}

async function aSealedFleet(): Promise<HostedFleet> {
  const fleet = await aHostedFleet();
  await installationIn(fleet.fleetId).fleet.turnOnSealing.mutate({ companyKey: await aKeyBoundTo(fleet.fleetId) });
  return fleet;
}

/** The tRPC error a call fails with, with the code a refusal reads. */
async function refusalOfCall(call: Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
  try {
    await call;
  } catch (error) {
    if (error instanceof TRPCClientError) {
      return { code: z.object({ code: z.string() }).safeParse(error.data).data?.code, message: error.message };
    }
    throw error;
  }
  throw new Error('Expected the call to be refused');
}

async function sealingOf(fleetId: FleetId) {
  const fleet = await prisma.fleet.findUniqueOrThrow({ where: { id: fleetId }, select: { sealingState: true, companyKey: true } });
  const dataKeys = await prisma.dataKey.findMany({ where: { fleetId } });
  const events = await prisma.event.findMany({ where: { fleetId, type: 'FleetSealingTurnedOn' }, select: { details: true } });
  return { ...fleet, dataKeys, events };
}

describe('turning sealing on, on Postgres and a LocalStack KMS (decision 0068, B4)', () => {
  it('scenario 1: a company key granted for this fleet seals the empty fleet with one current data key, and FleetSealingTurnedOn names the key reference and no key material', async () => {
    const { fleetId } = await aHostedFleet();
    const companyKey = await aKeyBoundTo(fleetId);

    const turnedOn = await installationIn(fleetId).fleet.turnOnSealing.mutate({ companyKey });

    expect(turnedOn).toEqual({ state: 'sealed', companyKey });
    const sealing = await sealingOf(fleetId);
    expect(sealing).toMatchObject({ sealingState: 'sealed', companyKey, events: [{ details: { companyKey } }] });
    expect(sealing.dataKeys.map(({ isCurrent }) => isCurrent)).toEqual([true]);
  });

  it('scenario 2: a company key granted without a fleet condition is refused KEY_NOT_BOUND_TO_FLEET and the fleet is unchanged', async () => {
    const { fleetId } = await aHostedFleet();

    const refusal = await refusalOfCall(installationIn(fleetId).fleet.turnOnSealing.mutate({ companyKey: await aCompanyKey() }));

    expect(refusal.code).toBe('BAD_REQUEST');
    expect(refusal.message).toContain('condition naming fleet');
    expect(await sealingOf(fleetId)).toEqual({ sealingState: null, companyKey: null, dataKeys: [], events: [] });
  });

  it('scenario 3: a company key the installation may not use is refused KEY_UNAVAILABLE naming access denied, and nothing is stored', async () => {
    const { fleetId } = await aHostedFleet();
    const companyKey = await aKeyBoundTo(fleetId);
    policy.refuseGrant(companyKey);

    const refusal = await refusalOfCall(installationIn(fleetId).fleet.turnOnSealing.mutate({ companyKey }));

    expect(refusal).toEqual({ code: 'SERVICE_UNAVAILABLE', message: "The fleet's company key is not reachable: access denied" });
    expect(await sealingOf(fleetId)).toEqual({ sealingState: null, companyKey: null, dataKeys: [], events: [] });
  });

  it('scenario 4: a ship of the fleet, argo included, is refused and nothing changes', async () => {
    const fleet = await aHostedFleet();
    const { crewToken } = await aClaimedReviewer(fleet, 'scout');
    const companyKey = await aKeyBoundTo(fleet.fleetId);

    const byShip = await refusalOfCall(client({ authorization: `Bearer ${crewToken}` }).fleet.turnOnSealing.mutate({ companyKey }));
    const byArgo = refusalOf(await useCases.turnOnSealing(fleet.argo, { companyKey }));

    expect([byShip.code, byArgo.kind]).toEqual(['FORBIDDEN', 'FORBIDDEN']);
    expect(await sealingOf(fleet.fleetId)).toEqual({ sealingState: null, companyKey: null, dataKeys: [], events: [] });
  });
});

describe('sealed sends and receives on Postgres and a LocalStack KMS (decision 0068, B7 to B9)', () => {
  it('scenario 7: the stored row holds ciphertext, the plain byte count and no plain payload, and the day counts the plain bytes', async () => {
    const fleet = await aSealedFleet();
    const scout = await aCrewedReviewer(fleet, 'scout');

    const { messageId } = unwrap(await useCases.sendMessage(fleet.argo, { selector: { kind: 'ship', shipId: scout.shipId }, payload: PAYLOAD, contentType: 'text/plain', idempotencyKey: newKey() }));

    const row = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(row).toMatchObject({ payload: null, sealedPayloadBytes: 84 });
    expect(row.sealedDataKeyId).toMatch(/^dky_/);
    expect(Buffer.from(row.sealedCiphertext ?? new Uint8Array()).toString('utf8')).not.toContain('Review');
    const [day] = await prisma.messageDay.findMany({ where: { fleetId: fleet.fleetId } });
    expect(day).toMatchObject({ messages: 1, payloadBytes: 84n });
  });

  it('scenario 11: a withdrawal of a sealed fleet is found by the question id it names', async () => {
    const fleet = await aSealedFleet();
    const scout = await aCrewedReviewer(fleet, 'scout');
    const { messageId } = unwrap(
      await useCases.sendMessage(scout, {
        selector: { kind: 'ship', shipId: fleet.argo.shipId },
        payload: JSON.stringify({ questionId: QUESTION_ID }),
        contentType: WITHDRAWAL_CONTENT_TYPE,
        idempotencyKey: newKey(),
        model: 'claude-opus-5-5',
      }),
    );

    const found = await prisma.message.findMany({ where: { fleetId: fleet.fleetId, questionId: QUESTION_ID }, select: { id: true, payload: true } });

    expect(found).toEqual([{ id: messageId, payload: null }]);
  });

  it('scenario 12: a pending sealed delivery is received with its plain payload, exactly as sent', async () => {
    const fleet = await aSealedFleet();
    const scout = await aCrewedReviewer(fleet, 'scout');
    unwrap(await useCases.sendMessage(fleet.argo, { selector: { kind: 'ship', shipId: scout.shipId }, payload: PAYLOAD, contentType: 'text/plain', idempotencyKey: newKey() }));

    const { deliveries } = unwrap(await useCases.receiveDeliveries(scout, {}));

    expect(deliveries.map(({ payload }) => payload)).toEqual([PAYLOAD]);
  });

  it('scenario 15: sealed deliveries waiting when core restarts are each received as sent after the restart', async () => {
    const fleet = await aSealedFleet();
    const scout = await aCrewedReviewer(fleet, 'scout');
    const sent: DeliveryId[] = [];
    for (const payload of [PAYLOAD, `${PAYLOAD} again`]) {
      unwrap(await useCases.sendMessage(fleet.argo, { selector: { kind: 'ship', shipId: scout.shipId }, payload, contentType: 'text/plain', idempotencyKey: newKey() }));
    }
    sent.push(...(await prisma.delivery.findMany({ where: { fleetId: fleet.fleetId }, orderBy: { id: 'asc' }, select: { id: true } })).map(({ id }) => idSchema('delivery').parse(id)));
    const restarted = createPrismaClient(databaseUrl);
    const afterRestart = createUseCases({ prisma: restarted, clock, keyVault: createAwsKmsKeyVault({ region: REGION, endpoint: policy.endpoint, credentials: CREDENTIALS }), receiveWaitMs: 0 });

    const { deliveries } = unwrap(await afterRestart.receiveDeliveries(scout, { max: 2 }));
    await restarted.$disconnect();

    expect(deliveries.map(({ deliveryId, payload }) => ({ deliveryId, payload }))).toEqual([
      { deliveryId: sent[0], payload: PAYLOAD },
      { deliveryId: sent[1], payload: `${PAYLOAD} again` },
    ]);
  });
});

/** A sealed message's or schedule's row holds no plain payload: ciphertext under a data key, beside the plain byte count. */
function expectSealedRow(row: { payload: string | null; sealedDataKeyId: string | null; sealedCiphertext: Uint8Array | null }, plainText: string): void {
  expect(row.payload).toBeNull();
  expect(row.sealedDataKeyId).toMatch(/^dky_/);
  expect(Buffer.from(row.sealedCiphertext ?? new Uint8Array()).toString('utf8')).not.toContain(plainText);
}

describe('every other payload sealed on Postgres and a LocalStack KMS (decision 0068, B17)', () => {
  it("scenario 16: a resend of a sealed undeliverable message is sealed for its own id, and its recipient reads the original's payload", async () => {
    const fleet = await aSealedFleet();
    const scout = await aCrewedReviewer(fleet, 'scout');
    const { messageId: originalId } = unwrap(await useCases.sendMessage(fleet.argo, { selector: { kind: 'ship', shipId: scout.shipId }, payload: PAYLOAD, contentType: 'text/plain', idempotencyKey: newKey() }));
    for (let claim = 1; claim <= 5; claim += 1) {
      unwrap(await useCases.receiveDeliveries(scout, {}));
    }
    const { id: deliveryId } = await prisma.delivery.findFirstOrThrow({ where: { fleetId: fleet.fleetId, messageId: originalId, state: 'undeliverable' }, select: { id: true } });

    const { messageId } = unwrap(await useCases.resendDelivery(fleet.argo, { deliveryId: idSchema('delivery').parse(deliveryId) }));

    const [original, resent] = await Promise.all([prisma.message.findUniqueOrThrow({ where: { id: originalId } }), prisma.message.findUniqueOrThrow({ where: { id: messageId } })]);
    expectSealedRow(resent, 'Review');
    expect(resent.sealedCiphertext).not.toEqual(original.sealedCiphertext);
    const { deliveries } = unwrap(await useCases.receiveDeliveries(scout, {}));
    expect(deliveries.map(({ messageId: id, payload }) => ({ id, payload }))).toEqual([{ id: messageId, payload: PAYLOAD }]);
  });

  it('stores a ping core writes sealed, and its ship receives it as written', async () => {
    const fleet = await aSealedFleet();
    const scout = await aCrewedReviewer(fleet, 'scout');

    const { messageId } = unwrap(await useCases.pingShip(fleet.argo, { shipId: scout.shipId }));

    expectSealedRow(await prisma.message.findUniqueOrThrow({ where: { id: messageId } }), 'Ping');
    const { deliveries } = unwrap(await useCases.receiveDeliveries(scout, {}));
    expect(deliveries.map(({ contentType, payload }) => ({ contentType, payload }))).toEqual([{ contentType: PING_CONTENT_TYPE, payload: PING_PAYLOAD }]);
  });

  it("stores a meeting's added notice sealed, and the participant receives it as written", async () => {
    const fleet = await aSealedFleet();
    const scout = await aCrewedReviewer(fleet, 'scout');

    const { meetingId } = unwrap(await useCases.openMeeting(fleet.argo, { ships: [{ shipId: scout.shipId }], idempotencyKey: newKey(), title: 'Launch' }));

    const [notice] = await prisma.message.findMany({ where: { fleetId: fleet.fleetId, meetingId } });
    expect(notice).toBeDefined();
    expectSealedRow(notice ?? { payload: '', sealedDataKeyId: null, sealedCiphertext: null }, 'Launch');
    const { deliveries } = unwrap(await useCases.receiveDeliveries(scout, {}));
    expect(deliveries.map(({ contentType, payload }) => ({ contentType, payload: z.object({ meetingId: z.string(), title: z.string() }).parse(JSON.parse(payload)) }))).toEqual([
      { contentType: MEETING_ADDED_CONTENT_TYPE, payload: { meetingId, title: 'Launch' } },
    ]);
  });

  it("stores a schedule's payload sealed, and the message it sends at its time sealed for its own id, read in argo's inbox as scheduled", async () => {
    const fleet = await aSealedFleet();
    const scout = await aCrewedReviewer(fleet, 'scout');
    // A month before the database's clock: a schedule an hour ahead here is due by the claim's now().
    const monthEarlier = createTestClock('2026-09-29T12:00:00.000Z');
    const scheduling = createUseCases({ prisma, clock: monthEarlier, keyVault, receiveWaitMs: 0 });
    const { scheduleId } = unwrap(
      await scheduling.scheduleMessage(scout, { selector: { kind: 'ship', name: 'argo' }, payload: PAYLOAD, model: 'claude-opus-5-5', idempotencyKey: newKey(), timing: { kind: 'once', at: new Date('2026-09-29T13:00:00.000Z') } }),
    );
    monthEarlier.set('2026-09-29T13:00:00.000Z');

    await scheduling.sendDueSchedules();

    const schedule = await prisma.schedule.findUniqueOrThrow({ where: { id: scheduleId } });
    expectSealedRow(schedule, 'Review');
    expect(schedule.sealedPayloadBytes).toBe(84);
    const sent = await prisma.message.findFirstOrThrow({ where: { fleetId: fleet.fleetId, scheduleId } });
    expectSealedRow(sent, 'Review');
    const inbox = unwrap(await useCases.readInbox(fleet.argo, { filter: 'all' })).items;
    expect(inbox.map(({ message }) => ({ id: message.id, payload: message.payload }))).toEqual([{ id: sent.id, payload: PAYLOAD }]);
  });

  it("answers a message's page and the reply argo sent to it in its inbox, each payload as sent", async () => {
    const fleet = await aSealedFleet();
    const scout = await aCrewedReviewer(fleet, 'scout');
    const { messageId: asked } = unwrap(await useCases.sendMessage(scout, { selector: { kind: 'ship', shipId: fleet.argo.shipId }, payload: PAYLOAD, idempotencyKey: newKey(), model: 'claude-opus-5-5' }));
    unwrap(await useCases.sendMessage(fleet.argo, { selector: { kind: 'ship', shipId: scout.shipId }, payload: 'Done, 5 € spent', inReplyTo: asked, idempotencyKey: newKey() }));

    const page = unwrap(await useCases.readMessage(fleet.argo, { messageId: asked }));
    const [entry] = unwrap(await useCases.readInbox(fleet.argo, { filter: 'all' })).items;

    expect(page.payload).toBe(PAYLOAD);
    expect([entry?.message.payload, entry?.replies.map(({ payload }) => payload)]).toEqual([PAYLOAD, ['Done, 5 € spent']]);
  });
});

/** A sealed fleet with the reference of its company key, which the company may disable. */
async function aSealedFleetWithItsKey(): Promise<HostedFleet & { companyKey: string }> {
  const fleet = await aHostedFleet();
  const companyKey = await aKeyBoundTo(fleet.fleetId);
  await installationIn(fleet.fleetId).fleet.turnOnSealing.mutate({ companyKey });
  return { ...fleet, companyKey };
}

/** One server with its own data key cache and its own clock, from the given time. */
function aServerAt(iso: string) {
  const at = createTestClock(iso);
  return { clock: at, useCases: createUseCases({ prisma, clock: at, keyVault, receiveWaitMs: 0 }) };
}

async function disableKey(companyKey: string): Promise<void> {
  await company.send(new DisableKeyCommand({ KeyId: companyKey }));
}

async function enableKey(companyKey: string): Promise<void> {
  await company.send(new EnableKeyCommand({ KeyId: companyKey }));
}

const KEY_AVAILABILITY_EVENTS = ['FleetKeyUnavailable', 'FleetKeyAvailable'];

async function keyAvailabilityEvents(fleetId: FleetId) {
  return prisma.event.findMany({ where: { fleetId, type: { in: KEY_AVAILABILITY_EVENTS } }, orderBy: { seq: 'asc' }, select: { type: true, details: true } });
}

/** The fleet's messages and deliveries, and its events but those marking the key's availability. */
async function storedOf(fleetId: FleetId) {
  const [messages, deliveries, events] = await Promise.all([
    prisma.message.findMany({ where: { fleetId }, orderBy: { id: 'asc' } }),
    prisma.delivery.findMany({ where: { fleetId }, orderBy: { id: 'asc' } }),
    prisma.event.findMany({ where: { fleetId, type: { notIn: KEY_AVAILABILITY_EVENTS } }, orderBy: { seq: 'asc' } }),
  ]);
  return { messages, deliveries, events };
}

function aMessageTo(shipId: Crew['shipId'], payload = PAYLOAD) {
  return { selector: { kind: 'ship' as const, shipId }, payload, contentType: 'text/plain', idempotencyKey: newKey() };
}

describe('the kill switch on Postgres and a LocalStack KMS (decision 0068, B9, B11, B12)', () => {
  it('scenario 9: with the company key disabled and the data key cache run out, a send is refused KEY_UNAVAILABLE and no message, delivery or event is stored', async () => {
    const fleet = await aSealedFleetWithItsKey();
    const scout = await aCrewedReviewer(fleet, 'scout');
    const server = aServerAt('2026-10-29T12:00:00.000Z');
    unwrap(await server.useCases.sendMessage(fleet.argo, aMessageTo(scout.shipId)));
    await disableKey(fleet.companyKey);
    server.clock.advance(DATA_KEY_CACHE_MS);
    const before = await storedOf(fleet.fleetId);

    const refusal = refusalOf(await server.useCases.sendMessage(fleet.argo, aMessageTo(scout.shipId)));

    expect(refusal.kind).toBe('KEY_UNAVAILABLE');
    expect(await storedOf(fleet.fleetId)).toEqual(before);
  });

  it('scenario 13: with the key cut off, a receive and a push receive are refused KEY_UNAVAILABLE, the delivery stays pending and its attempts are unchanged', async () => {
    const fleet = await aSealedFleetWithItsKey();
    const scout = await aCrewedReviewer(fleet, 'scout');
    const server = aServerAt('2026-10-29T12:00:00.000Z');
    const { messageId } = unwrap(await server.useCases.sendMessage(fleet.argo, aMessageTo(scout.shipId)));
    await disableKey(fleet.companyKey);
    server.clock.advance(DATA_KEY_CACHE_MS);

    const received = refusalOf(await server.useCases.receiveDeliveries(scout, {}));
    const pushed = refusalOf(await server.useCases.pushReceiveDeliveries(scout, {}));

    expect([received.kind, pushed.kind]).toEqual(['KEY_UNAVAILABLE', 'KEY_UNAVAILABLE']);
    expect(await prisma.delivery.findFirstOrThrow({ where: { messageId }, select: { state: true, attempts: true } })).toEqual({ state: 'pending', attempts: 0 });
  });

  it('scenario 22: when the company disables its key, sends and receives are refused KEY_UNAVAILABLE within 5 minutes, FleetKeyUnavailable is written once, and pong, acknowledge and pruning go on', async () => {
    const fleet = await aSealedFleetWithItsKey();
    const scout = await aCrewedReviewer(fleet, 'scout');
    const server = aServerAt('2026-10-29T12:00:00.000Z');
    const { messageId: finished } = unwrap(await server.useCases.sendMessage(fleet.argo, aMessageTo(scout.shipId)));
    const { messageId: ping } = unwrap(await server.useCases.pingShip(fleet.argo, { shipId: scout.shipId }));
    const handed = unwrap(await server.useCases.receiveDeliveries(scout, { max: 10 })).deliveries;
    await prisma.$executeRaw`UPDATE fleets SET retention_set = true, retention_days = 1 WHERE id = ${fleet.fleetId}`;
    await disableKey(fleet.companyKey);
    server.clock.advance(DATA_KEY_CACHE_MS - 1_000);
    unwrap(await server.useCases.sendMessage(fleet.argo, aMessageTo(scout.shipId, 'served from the cache')));

    server.clock.advance(1_000);
    const sent = refusalOf(await server.useCases.sendMessage(fleet.argo, aMessageTo(scout.shipId)));
    const received = refusalOf(await server.useCases.receiveDeliveries(scout, {}));
    const deliveryOf = (messageId: string) => handed.find((delivery) => delivery.messageId === messageId)?.deliveryId ?? idSchema('delivery').parse(newKey());
    unwrap(await server.useCases.acknowledgeDelivery(scout, { deliveryId: deliveryOf(finished) }));
    unwrap(await server.useCases.answerPing(scout, { deliveryId: deliveryOf(ping) }));
    // The 30 second pass past the retention: the snapshot close, then the pruning pass.
    server.clock.advance(2 * 24 * 60 * 60 * 1000);
    await server.useCases.closeHealthSnapshots();
    await server.useCases.pruneHistory();

    expect([sent.kind, received.kind]).toEqual(['KEY_UNAVAILABLE', 'KEY_UNAVAILABLE']);
    expect(await keyAvailabilityEvents(fleet.fleetId)).toEqual([{ type: 'FleetKeyUnavailable', details: { reason: 'disabled' } }]);
    expect(await prisma.message.count({ where: { id: { in: [finished, ping] } } })).toBe(0);
  });

  it('scenario 23: when the company enables its disabled key again, FleetKeyAvailable is written once and every waiting delivery is received, none lost or undeliverable', async () => {
    const fleet = await aSealedFleetWithItsKey();
    const scout = await aCrewedReviewer(fleet, 'scout');
    const server = aServerAt('2026-10-29T12:00:00.000Z');
    for (const payload of [PAYLOAD, `${PAYLOAD} again`]) {
      unwrap(await server.useCases.sendMessage(fleet.argo, aMessageTo(scout.shipId, payload)));
    }
    await disableKey(fleet.companyKey);
    server.clock.advance(DATA_KEY_CACHE_MS);
    for (let refused = 0; refused < 5; refused += 1) {
      refusalOf(await server.useCases.receiveDeliveries(scout, {}));
    }

    await enableKey(fleet.companyKey);
    const { deliveries } = unwrap(await server.useCases.receiveDeliveries(scout, { max: 10 }));
    unwrap(await server.useCases.sendMessage(fleet.argo, aMessageTo(scout.shipId)));

    expect(deliveries.map(({ payload, attempts }) => ({ payload, attempts }))).toEqual([
      { payload: PAYLOAD, attempts: 1 },
      { payload: `${PAYLOAD} again`, attempts: 1 },
    ]);
    expect((await keyAvailabilityEvents(fleet.fleetId)).map(({ type }) => type)).toEqual(['FleetKeyUnavailable', 'FleetKeyAvailable']);
  });

  it('scenario 24: with the key disabled, a due schedule records its send refused KEY_UNAVAILABLE', async () => {
    const fleet = await aSealedFleetWithItsKey();
    const scout = await aCrewedReviewer(fleet, 'scout');
    // A month before the database's clock: a schedule an hour ahead here is due by the claim's now().
    const server = aServerAt('2026-09-29T12:00:00.000Z');
    const { scheduleId } = unwrap(
      await server.useCases.scheduleMessage(scout, {
        selector: { kind: 'ship', name: 'argo' },
        payload: PAYLOAD,
        model: 'claude-opus-5-5',
        idempotencyKey: newKey(),
        timing: { kind: 'once', at: new Date('2026-09-29T13:00:00.000Z') },
        onRefused: 'skip',
      }),
    );
    await disableKey(fleet.companyKey);
    server.clock.set('2026-09-29T13:00:00.000Z');

    await server.useCases.sendDueSchedules();

    // The app's own schedule timer may claim it first: whichever pass records the refusal, it is recorded once.
    await expect.poll(async () => prisma.schedule.findUniqueOrThrow({ where: { id: scheduleId }, select: { lastOutcomeKind: true, lastRefusalCode: true } })).toEqual({ lastOutcomeKind: 'refused', lastRefusalCode: 'KEY_UNAVAILABLE' });
    expect(await prisma.event.count({ where: { fleetId: fleet.fleetId, type: 'ScheduledSendRefused' } })).toBe(1);
    expect(await prisma.message.count({ where: { fleetId: fleet.fleetId, scheduleId } })).toBe(0);
  });
});
