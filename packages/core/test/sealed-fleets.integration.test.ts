import { CreateKeyCommand, DisableKeyCommand, EnableKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { createIdGenerator, FLEET_HEADER, idSchema, MEETING_ADDED_CONTENT_TYPE, PING_CONTENT_TYPE, SCOPES, WITHDRAWAL_CONTENT_TYPE, type DeliveryId, type FleetId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink, TRPCClientError, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createAwsKmsKeyVault } from '../src/adapters/kms/aws-kms-key-vault.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaTx } from '../src/adapters/prisma/unit-of-work.js';
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
const newId = createIdGenerator();

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

/** A ship argo granted fleet:keys (decision 0046), calling with its crew token. */
async function aKeyHolder(fleet: HostedFleet): Promise<TRPCClient<AppRouter>> {
  const { crewToken, crew } = await aClaimedReviewer(fleet, 'keeper');
  unwrap(await useCases.grantScopes(fleet.argo, { shipId: crew.shipId, grant: ['fleet:keys'], revoke: [] }));
  return client({ authorization: `Bearer ${crewToken}` });
}

async function aSealedFleet(): Promise<HostedFleet> {
  const fleet = await aHostedFleet();
  unwrap(await useCases.turnOnSealing(fleet.argo, { companyKey: await aKeyBoundTo(fleet.fleetId) }));
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
    const fleet = await aHostedFleet();
    const { fleetId } = fleet;
    const companyKey = await aKeyBoundTo(fleetId);

    const turnedOn = await (await aKeyHolder(fleet)).fleet.turnOnSealing.mutate({ companyKey });

    expect(turnedOn).toEqual({ state: 'sealed', companyKey });
    const sealing = await sealingOf(fleetId);
    expect(sealing).toMatchObject({ sealingState: 'sealed', companyKey, events: [{ details: { companyKey } }] });
    expect(sealing.dataKeys.map(({ isCurrent }) => isCurrent)).toEqual([true]);
  });

  it('scenario 2: a company key granted without a fleet condition is refused KEY_NOT_BOUND_TO_FLEET and the fleet is unchanged', async () => {
    const fleet = await aHostedFleet();
    const { fleetId } = fleet;

    const refusal = await refusalOfCall((await aKeyHolder(fleet)).fleet.turnOnSealing.mutate({ companyKey: await aCompanyKey() }));

    expect(refusal.code).toBe('BAD_REQUEST');
    expect(refusal.message).toContain('condition naming fleet');
    expect(await sealingOf(fleetId)).toEqual({ sealingState: null, companyKey: null, dataKeys: [], events: [] });
  });

  it('scenario 3: a company key the installation may not use is refused KEY_UNAVAILABLE naming access denied, and nothing is stored', async () => {
    const fleet = await aHostedFleet();
    const { fleetId } = fleet;
    const companyKey = await aKeyBoundTo(fleetId);
    policy.refuseGrant(companyKey);

    const refusal = await refusalOfCall((await aKeyHolder(fleet)).fleet.turnOnSealing.mutate({ companyKey }));

    expect(refusal).toEqual({ code: 'SERVICE_UNAVAILABLE', message: "The fleet's company key is not reachable: access denied" });
    expect(await sealingOf(fleetId)).toEqual({ sealingState: null, companyKey: null, dataKeys: [], events: [] });
  });

  it('scenario 4: a ship without fleet:keys is refused and nothing changes, nor does the installation without it', async () => {
    const fleet = await aHostedFleet();
    const { crewToken } = await aClaimedReviewer(fleet, 'scout');
    const companyKey = await aKeyBoundTo(fleet.fleetId);

    const byShip = await refusalOfCall(client({ authorization: `Bearer ${crewToken}` }).fleet.turnOnSealing.mutate({ companyKey }));
    const byInstallation = await refusalOfCall(installationIn(fleet.fleetId).fleet.turnOnSealing.mutate({ companyKey }));

    expect([byShip.code, byInstallation.code]).toEqual(['FORBIDDEN', 'FORBIDDEN']);
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

    // The app's own schedule timer may hold it while this pass looks: whichever pass sends it, it is sent once.
    await expect.poll(() => prisma.message.count({ where: { fleetId: fleet.fleetId, scheduleId } })).toBe(1);
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
  unwrap(await useCases.turnOnSealing(fleet.argo, { companyKey }));
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

  it("fleet.sealing reads the state, the company key, its availability since when and the data keys' ages, never a key", async () => {
    const fleet = await aSealedFleetWithItsKey();
    const scout = await aCrewedReviewer(fleet, 'scout');
    const server = aServerAt('2026-10-29T12:00:00.000Z');
    await disableKey(fleet.companyKey);
    refusalOf(await server.useCases.sendMessage(fleet.argo, aMessageTo(scout.shipId)));
    const [dataKey] = await prisma.dataKey.findMany({ where: { fleetId: fleet.fleetId } });

    const sealing = await installationIn(fleet.fleetId).fleet.sealing.query();

    expect(sealing).toEqual({
      state: 'sealed',
      companyKey: fleet.companyKey,
      keyAvailability: { isAvailable: false, reason: 'disabled', since: '2026-10-29T12:00:00.000Z' },
      dataKeys: [{ id: dataKey?.id, createdAt: dataKey?.createdAt.toISOString(), isCurrent: true }],
    });
  });

  it('fleet.health says the company key is not reachable, with its reason and since when', async () => {
    const fleet = await aSealedFleetWithItsKey();
    const scout = await aCrewedReviewer(fleet, 'scout');
    const server = aServerAt('2026-10-29T12:00:00.000Z');
    await disableKey(fleet.companyKey);
    refusalOf(await server.useCases.sendMessage(fleet.argo, aMessageTo(scout.shipId)));

    const health = await installationIn(fleet.fleetId).fleet.health.query();

    expect(health.keyUnavailable).toEqual({ reason: 'disabled', since: '2026-10-29T12:00:00.000Z' });
  });

  it("fleet.inbox marks a payload it cannot unseal unreadable, with no payload, and lists the rest", async () => {
    const fleet = await aHostedFleet();
    const scout = await aCrewedReviewer(fleet, 'scout');
    const server = aServerAt('2026-10-29T12:00:00.000Z');
    const { messageId: plain } = unwrap(await server.useCases.sendMessage(scout, { ...aMessageTo(fleet.argo.shipId, 'sent before sealing'), model: 'claude-opus-5-5' }));
    const companyKey = await aKeyBoundTo(fleet.fleetId);
    unwrap(await useCases.turnOnSealing(fleet.argo, { companyKey }));
    const { messageId: sealed } = unwrap(await server.useCases.sendMessage(scout, { ...aMessageTo(fleet.argo.shipId), model: 'claude-opus-5-5' }));
    await disableKey(companyKey);
    server.clock.advance(DATA_KEY_CACHE_MS);

    const inbox = await installationIn(fleet.fleetId).fleet.inbox.query({ filter: 'all' });

    expect(inbox.items.map(({ message }) => ({ id: message.id, payload: message.payload, isPayloadUnreadable: message.isPayloadUnreadable }))).toEqual([
      { id: sealed, payload: '', isPayloadUnreadable: true },
      { id: plain, payload: 'sent before sealing', isPayloadUnreadable: false },
    ]);
  });
});

/** The fleet's messages and schedules still stored plain, and its sealing pass's state and events. */
async function sealingPassOf(fleetId: FleetId) {
  const [plainMessages, plainSchedules, fleet, sealedEvents] = await Promise.all([
    prisma.message.count({ where: { fleetId, payload: { not: null } } }),
    prisma.schedule.count({ where: { fleetId, payload: { not: null } } }),
    prisma.fleet.findUniqueOrThrow({ where: { id: fleetId }, select: { sealingState: true } }),
    prisma.event.findMany({ where: { fleetId, type: 'FleetPayloadsSealed' }, select: { actorKind: true } }),
  ]);
  return { plainMessages, plainSchedules, state: fleet.sealingState, sealedEvents };
}

/** Sends from argo to the ship, a few at once, each with its own payload. */
async function plainSends(fleet: HostedFleet, sends: { to: Crew; count: number }): Promise<void> {
  const { to, count } = sends;
  const AT_ONCE = 25;
  for (let first = 0; first < count; first += AT_ONCE) {
    const sends = Array.from({ length: Math.min(AT_ONCE, count - first) }, (_, offset) => useCases.sendMessage(fleet.argo, aMessageTo(to.shipId, `${PAYLOAD} #${first + offset}`)));
    for (const sent of await Promise.all(sends)) {
      unwrap(sent);
    }
  }
}

/** Every delivery waiting for the ship, received in pages: their payloads, in the order sent. */
async function everyPayloadReceived(crew: Crew): Promise<string[]> {
  const payloads: string[] = [];
  for (;;) {
    const { deliveries } = unwrap(await useCases.receiveDeliveries(crew, { max: 10 }));
    if (deliveries.length === 0) {
      return payloads;
    }
    payloads.push(...deliveries.map(({ payload }) => payload));
    for (const { deliveryId } of deliveries) {
      unwrap(await useCases.acknowledgeDelivery(crew, { deliveryId }));
    }
  }
}

describe('the sealing pass on Postgres and a LocalStack KMS (decision 0068, B5)', () => {
  it('scenario 5: given a fleet with a thousand plain messages and ten schedules, when it turns sealing on, then the sealing pass seals every one in batches, FleetPayloadsSealed is written once, and the database holds no plain payload of the fleet', { timeout: 180_000 }, async () => {
    const fleet = await aHostedFleet();
    const scout = await aCrewedReviewer(fleet, 'scout');
    await plainSends(fleet, { to: scout, count: 1000 });
    for (let day = 1; day <= 10; day += 1) {
      unwrap(
        await useCases.scheduleMessage(scout, {
          selector: { kind: 'ship', name: 'argo' },
          payload: `${PAYLOAD} on day ${day}`,
          model: 'claude-opus-5-5',
          idempotencyKey: newKey(),
          timing: { kind: 'once', at: new Date(`2026-12-${String(day).padStart(2, '0')}T10:00:00.000Z`) },
        }),
      );
    }
    const before = await prisma.message.findFirstOrThrow({ where: { fleetId: fleet.fleetId }, orderBy: { id: 'asc' }, select: { id: true, requestHash: true } });

    const turnedOn = unwrap(await useCases.turnOnSealing(fleet.argo, { companyKey: await aKeyBoundTo(fleet.fleetId) }));
    await useCases.sealStoredPayloads();
    await useCases.sealStoredPayloads();

    expect(turnedOn.state).toBe('sealing');
    expect(await sealingPassOf(fleet.fleetId)).toEqual({ plainMessages: 0, plainSchedules: 0, state: 'sealed', sealedEvents: [{ actorKind: 'system' }] });
    const [message, schedule] = await Promise.all([
      prisma.message.findUniqueOrThrow({ where: { id: before.id } }),
      prisma.schedule.findFirstOrThrow({ where: { fleetId: fleet.fleetId } }),
    ]);
    expectSealedRow(message, 'Review');
    expectSealedRow(schedule, 'Review');
    expect(message.requestHash).not.toBe(before.requestHash);
    const payloads = await everyPayloadReceived(scout);
    expect(payloads).toHaveLength(1000);
    expect(new Set(payloads)).toEqual(new Set(Array.from({ length: 1000 }, (_, index) => `${PAYLOAD} #${index}`)));
  });

  it('the pass racing a send: a send that read no data key before sealing was turned on commits its plain payload before turning on looks for one, and the pass seals it', { timeout: 180_000 }, async () => {
    const fleet = await aHostedFleet();
    const scout = await aCrewedReviewer(fleet, 'scout');
    const companyKey = await aKeyBoundTo(fleet.fleetId);
    const at = clock.now();
    const messageId = newId('message');
    let turnedOn: ReturnType<typeof useCases.turnOnSealing> | undefined;

    // The send's own unit of work, held open between its read of the key and its commit.
    await prisma.$transaction(
      async (tx) => {
        const unit = createPrismaTx(tx);
        expect(await unit.sealings.currentDataKeyId(fleet.fleetId)).toBeUndefined();
        turnedOn = useCases.turnOnSealing(fleet.argo, { companyKey });
        await expect.poll(() => backendsWaitingOnALock(), { timeout: 20_000 }).toBeGreaterThan(0);
        await unit.messages.create({
          id: messageId,
          fleetId: fleet.fleetId,
          senderShipId: fleet.argo.shipId,
          selector: { kind: 'ship', shipId: scout.shipId },
          payload: PAYLOAD,
          contentType: 'text/plain',
          model: null,
          idempotencyKey: newKey(),
          requestHash: 'a request hash',
          questionId: null,
          inReplyToMessageId: null,
          resendOfMessageId: null,
          meetingId: null,
          scheduleId: null,
          sendTime: null,
          createdAt: at,
        });
      },
      { timeout: 30_000 },
    );
    const state = unwrap(await (turnedOn ?? Promise.reject(new Error('turning sealing on never started')))).state;
    await useCases.sealStoredPayloads();

    expect(state).toBe('sealing');
    expect(await sealingPassOf(fleet.fleetId)).toEqual({ plainMessages: 0, plainSchedules: 0, state: 'sealed', sealedEvents: [{ actorKind: 'system' }] });
    expectSealedRow(await prisma.message.findUniqueOrThrow({ where: { id: messageId } }), 'Review');
  });

  it('the pass racing sends: each send during the pass is stored sealed or sealed by it, none plain, and each is received as sent', { timeout: 180_000 }, async () => {
    const fleet = await aHostedFleet();
    const scout = await aCrewedReviewer(fleet, 'scout');
    await plainSends(fleet, { to: scout, count: 400 });
    unwrap(await useCases.turnOnSealing(fleet.argo, { companyKey: await aKeyBoundTo(fleet.fleetId) }));

    const sendsDuringThePass = Array.from({ length: 40 }, (_, index) => useCases.sendMessage(fleet.argo, aMessageTo(scout.shipId, `${PAYLOAD} during #${index}`)));
    const [, ...sent] = await Promise.all([useCases.sealStoredPayloads(), ...sendsDuringThePass]);
    await useCases.sealStoredPayloads();

    expect(sent.filter((result) => !result.isOk)).toEqual([]);
    expect(await sealingPassOf(fleet.fleetId)).toEqual({ plainMessages: 0, plainSchedules: 0, state: 'sealed', sealedEvents: [{ actorKind: 'system' }] });
    expect(await everyPayloadReceived(scout)).toHaveLength(440);
  });

  it("the pass racing a resend: a plain undeliverable message resent during the pass is sealed, the resend sealed for its own id, and its recipient reads the original's payload", { timeout: 180_000 }, async () => {
    const fleet = await aHostedFleet();
    const scout = await aCrewedReviewer(fleet, 'scout');
    const { messageId: originalId } = unwrap(await useCases.sendMessage(fleet.argo, aMessageTo(scout.shipId)));
    for (let claim = 1; claim <= 5; claim += 1) {
      unwrap(await useCases.receiveDeliveries(scout, {}));
    }
    const { id: deliveryId } = await prisma.delivery.findFirstOrThrow({ where: { fleetId: fleet.fleetId, messageId: originalId, state: 'undeliverable' }, select: { id: true } });
    await plainSends(fleet, { to: scout, count: 200 });
    unwrap(await useCases.turnOnSealing(fleet.argo, { companyKey: await aKeyBoundTo(fleet.fleetId) }));

    const [, resent] = await Promise.all([useCases.sealStoredPayloads(), useCases.resendDelivery(fleet.argo, { deliveryId: idSchema('delivery').parse(deliveryId) })]);
    await useCases.sealStoredPayloads();

    const { messageId } = unwrap(resent);
    expect(await sealingPassOf(fleet.fleetId)).toEqual({ plainMessages: 0, plainSchedules: 0, state: 'sealed', sealedEvents: [{ actorKind: 'system' }] });
    expectSealedRow(await prisma.message.findUniqueOrThrow({ where: { id: originalId } }), 'Review');
    expectSealedRow(await prisma.message.findUniqueOrThrow({ where: { id: messageId } }), 'Review');
    const received = await everyPayloadReceived(scout);
    expect(received.filter((payload) => payload === PAYLOAD)).toHaveLength(1);
  });

  it('the pass racing a pruning pass: each finished message past the retention is pruned or sealed, none left plain, and neither pass fails', { timeout: 180_000 }, async () => {
    const fleet = await aHostedFleet();
    const scout = await aCrewedReviewer(fleet, 'scout');
    const server = aServerAt('2026-10-29T12:00:00.000Z');
    for (let index = 0; index < 300; index += 1) {
      unwrap(await server.useCases.sendMessage(fleet.argo, aMessageTo(scout.shipId, `${PAYLOAD} #${index}`)));
    }
    for (let page = 0; page < 10; page += 1) {
      for (const { deliveryId } of unwrap(await server.useCases.receiveDeliveries(scout, { max: 10 })).deliveries) {
        unwrap(await server.useCases.acknowledgeDelivery(scout, { deliveryId }));
      }
    }
    await prisma.$executeRaw`UPDATE fleets SET retention_set = true, retention_days = 1 WHERE id = ${fleet.fleetId}`;
    unwrap(await server.useCases.turnOnSealing(fleet.argo, { companyKey: await aKeyBoundTo(fleet.fleetId) }));
    // The 30 second pass past the retention: the snapshot close, then the pruning and the sealing passes at once.
    server.clock.advance(2 * 24 * 60 * 60 * 1000);
    await server.useCases.closeHealthSnapshots();
    const failures: unknown[] = [];

    await Promise.all([server.useCases.pruneHistory((_, error) => failures.push(error)), server.useCases.sealStoredPayloads((_, error) => failures.push(error))]);
    await server.useCases.sealStoredPayloads((_, error) => failures.push(error));

    expect(failures).toEqual([]);
    expect(await sealingPassOf(fleet.fleetId)).toEqual({ plainMessages: 0, plainSchedules: 0, state: 'sealed', sealedEvents: [{ actorKind: 'system' }] });
    expect(await prisma.message.count({ where: { fleetId: fleet.fleetId } })).toBeGreaterThanOrEqual(200);
  });
});

/** How many server processes of this database wait on a lock now. */
async function backendsWaitingOnALock(): Promise<number> {
  const [row] = z
    .array(z.object({ waiting: z.bigint() }))
    .parse(await prisma.$queryRaw`SELECT count(*) AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`);
  return Number(row?.waiting ?? 0n);
}
