import { createIdGenerator, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createSignIn } from '../src/core/identity/sign-in.js';
import { createUseCases } from '../src/wiring.js';
import { FLEET_URL } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';

// The identity use cases on a real Postgres through the Prisma adapters:
// takeover, sign-out, replacing the secret, rollback, concurrency and restart.

const DAY_MS = 24 * 60 * 60 * 1000;
const newId = createIdGenerator();

let core: PostgresCore;
let fleetId: FleetId;
let argoId: ShipId;
let secret: string;

beforeEach(async () => {
  core = await createPostgresCore();
  ({ fleetId, operatorShipId: argoId, secret } = unwrap(await core.useCases.initialiseFleet({ name: 'home fleet' })));
});

afterEach(async () => {
  await core.close();
});

async function liveSessions() {
  return core.prisma.consoleSession.findMany({ where: { endedAt: null } });
}

async function openLeases() {
  return core.prisma.lease.findMany({ where: { endedAt: null } });
}

async function eventTypes() {
  const events = await core.prisma.event.findMany({ orderBy: { id: 'asc' }, where: { type: { notIn: ['FleetInitialised', 'ShipCommissioned'] } } });
  return events.map((event) => event.type);
}

/** A message to argo that argo has claimed but not acknowledged. */
async function deliveryInFlightToArgo(): Promise<string> {
  const messageId = newId('message');
  await core.prisma.message.create({
    data: { id: messageId, fleetId, payload: '{}', contentType: 'application/json', idempotencyKey: messageId, createdAt: core.clock.now() },
  });
  const deliveryId = newId('delivery');
  await core.prisma.delivery.create({
    data: {
      id: deliveryId,
      fleetId,
      messageId,
      recipientShipId: argoId,
      state: 'delivered',
      claimedByShipId: argoId,
      attempts: 1,
      createdAt: core.clock.now(),
    },
  });
  return deliveryId;
}

describe('signing in on Postgres', () => {
  it('stores the session by token hash and a lease from the web console', async () => {
    const { token, consoleSessionId } = unwrap(await core.useCases.signIn({ secret }));

    const [session] = await liveSessions();
    const [lease] = await openLeases();
    expect(session).toMatchObject({
      id: consoleSessionId,
      shipId: argoId,
      tokenHash: sha256Hasher.hash(token),
      leaseId: lease?.id,
      expiresAt: new Date(core.clock.now().getTime() + 30 * DAY_MS),
    });
    expect(lease).toMatchObject({ shipId: argoId, location: 'OTHER', locationDescription: 'web console' });
    await expect(eventTypes()).resolves.toEqual(['ShipClaimed']);
  });

  it('takes over: the first session and lease end, deliveries in flight return to pending', async () => {
    const first = unwrap(await core.useCases.signIn({ secret }));
    const deliveryId = await deliveryInFlightToArgo();

    const second = unwrap(await core.useCases.signIn({ secret }));

    await expect(core.useCases.authenticate.byConsoleSession(first.token)).resolves.toBeUndefined();
    await expect(core.useCases.authenticate.byConsoleSession(second.token)).resolves.toMatchObject({ caller: { shipId: argoId } });
    await expect(liveSessions()).resolves.toEqual([expect.objectContaining({ id: second.consoleSessionId })]);
    await expect(openLeases()).resolves.toHaveLength(1);
    await expect(core.prisma.delivery.findUnique({ where: { id: deliveryId } })).resolves.toMatchObject({
      state: 'pending',
      claimedByShipId: null,
    });
    await expect(eventTypes()).resolves.toEqual(['ShipClaimed', 'LeaseRevoked', 'ShipClaimed']);
  });

  it('serialises concurrent sign-ins: every one succeeds, one session and one lease stay', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => core.useCases.signIn({ secret })));

    expect(results.map((result) => result.isOk)).toEqual([true, true, true, true, true]);
    await expect(liveSessions()).resolves.toHaveLength(1);
    await expect(openLeases()).resolves.toHaveLength(1);
    const types = await eventTypes();
    expect(types.filter((type) => type === 'ShipClaimed')).toHaveLength(5);
    expect(types.filter((type) => type === 'LeaseRevoked')).toHaveLength(4);
  });

  it('leaves the first session and lease untouched when a sign-in fails halfway', async () => {
    const first = unwrap(await core.useCases.signIn({ secret }));
    const failingUow = createPrismaUnitOfWork(core.prisma);
    const signIn = createSignIn({
      uow: {
        run: (work) =>
          failingUow.run((tx) =>
            work({ ...tx, consoleSessions: { ...tx.consoleSessions, create: () => Promise.reject(new Error('disk full')) } }),
          ),
      },
      clock: core.clock,
      ids: newId,
      hasher: sha256Hasher,
      random: { next: () => 'token' },
    });

    await expect(signIn({ secret })).rejects.toThrow('disk full');

    await expect(core.useCases.authenticate.byConsoleSession(first.token)).resolves.toMatchObject({ caller: { shipId: argoId } });
    await expect(liveSessions()).resolves.toEqual([expect.objectContaining({ id: first.consoleSessionId })]);
    await expect(openLeases()).resolves.toHaveLength(1);
    await expect(eventTypes()).resolves.toEqual(['ShipClaimed']);
  });
});

describe('a console session on Postgres', () => {
  it('expires 30 days after its last use, and each use moves that', async () => {
    const { token } = unwrap(await core.useCases.signIn({ secret }));
    core.clock.advance(29 * DAY_MS);
    await expect(core.useCases.authenticate.byConsoleSession(token)).resolves.toBeDefined();
    core.clock.advance(30 * DAY_MS - 1);
    await expect(core.useCases.authenticate.byConsoleSession(token)).resolves.toBeDefined();

    core.clock.advance(30 * DAY_MS);

    await expect(core.useCases.authenticate.byConsoleSession(token)).resolves.toBeUndefined();
  });

  it('survives a server restart: a new client finds it', async () => {
    const { token } = unwrap(await core.useCases.signIn({ secret }));
    const restarted = createPrismaClient(core.databaseUrl);
    try {
      const useCases = createUseCases({ prisma: restarted, clock: core.clock, fleetUrl: FLEET_URL });

      await expect(useCases.authenticate.byConsoleSession(token)).resolves.toMatchObject({ caller: { shipId: argoId, fleetId } });
    } finally {
      await restarted.$disconnect();
    }
  });
});

describe('signing out on Postgres', () => {
  it("ends the session and argo's lease", async () => {
    const { token, caller } = unwrap(await core.useCases.signIn({ secret }));
    const deliveryId = await deliveryInFlightToArgo();

    await core.useCases.signOut(caller);

    await expect(core.useCases.authenticate.byConsoleSession(token)).resolves.toBeUndefined();
    await expect(liveSessions()).resolves.toEqual([]);
    await expect(openLeases()).resolves.toEqual([]);
    await expect(core.prisma.delivery.findUnique({ where: { id: deliveryId } })).resolves.toMatchObject({ state: 'pending' });
    await expect(eventTypes()).resolves.toEqual(['ShipClaimed', 'LeaseRevoked']);
  });
});

describe("replacing argo's secret on Postgres", () => {
  it('makes the old secret fail, ends every session and the lease', async () => {
    const { token } = unwrap(await core.useCases.signIn({ secret }));

    const replaced = unwrap(await core.useCases.replaceOperatorSecret({ fleetId }));

    await expect(core.useCases.signIn({ secret })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_SECRET' },
    });
    await expect(core.useCases.authenticate.bySecret(secret)).resolves.toBeUndefined();
    await expect(core.useCases.authenticate.byConsoleSession(token)).resolves.toBeUndefined();
    await expect(core.useCases.authenticate.bySecret(replaced.secret)).resolves.toMatchObject({ shipId: argoId });
    await expect(liveSessions()).resolves.toEqual([]);
    await expect(openLeases()).resolves.toEqual([]);
    await expect(core.prisma.credential.count({ where: { invalidatedAt: null } })).resolves.toBe(1);
    await expect(eventTypes()).resolves.toEqual(['ShipClaimed', 'CredentialRevoked', 'LeaseRevoked']);
  });

  it('never lets a concurrent sign-in with the old secret outlive the replacement', async () => {
    const [signIn, replaced] = await Promise.all([
      core.useCases.signIn({ secret }),
      core.useCases.replaceOperatorSecret({ fleetId }),
    ]);

    expect(replaced.isOk).toBe(true);
    if (signIn.isOk) {
      await expect(core.useCases.authenticate.byConsoleSession(signIn.value.token)).resolves.toBeUndefined();
    } else {
      expect(signIn.error).toMatchObject({ kind: 'INVALID_SECRET' });
    }
    await expect(liveSessions()).resolves.toEqual([]);
    await expect(openLeases()).resolves.toEqual([]);
    await expect(core.useCases.authenticate.bySecret(secret)).resolves.toBeUndefined();
  });
});

describe('the caller lookups', () => {
  it('find the ship, fleet, kind and scopes by secret hash alone', async () => {
    await expect(core.useCases.authenticate.bySecret(secret)).resolves.toEqual({
      shipId: argoId,
      fleetId,
      kind: 'operator',
      scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'],
    });
  });

  it('know no secret of another length or content', async () => {
    await expect(core.useCases.authenticate.bySecret(`${secret}x`)).resolves.toBeUndefined();
    await expect(core.useCases.authenticate.byConsoleSession(secret)).resolves.toBeUndefined();
  });
});
