import { CreateKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { FLEET_HEADER, idSchema, SCOPES, WITHDRAWAL_CONTENT_TYPE, type DeliveryId, type FleetId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink, TRPCClientError, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
async function refusalOfCall(call: Promise<unknown>): Promise<{ code: unknown; message: string }> {
  try {
    await call;
  } catch (error) {
    if (error instanceof TRPCClientError) {
      return { code: error.data?.code, message: error.message };
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
