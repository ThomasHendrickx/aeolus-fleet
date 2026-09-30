import { createIdGenerator, SCOPES, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { argon2idPasswordHasher } from '../src/adapters/crypto/passwords.js';
import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaOperatorAccountLookup } from '../src/adapters/prisma/identity.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createSignIn } from '../src/core/identity/sign-in.js';
import { ok } from '../src/core/shared/result.js';
import { createUseCases } from '../src/wiring.js';
import { FLEET_URL, OPERATOR, secretIn } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';

// The identity use cases on a real Postgres through the Prisma adapters:
// takeover, sign-out, resetting the password, rollback, concurrency and restart.

const DAY_MS = 24 * 60 * 60 * 1000;
const newId = createIdGenerator();

let core: PostgresCore;
let fleetId: FleetId;
let argoId: ShipId;

beforeEach(async () => {
  core = await createPostgresCore();
  ({ fleetId, operatorShipId: argoId } = unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
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

/** A message to argo that argo's crew, the live console session, has claimed but not acknowledged. */
async function deliveryInFlightToArgo(): Promise<string> {
  const lease = await core.prisma.lease.findFirstOrThrow({ where: { shipId: argoId, endedAt: null } });
  const messageId = newId('message');
  await core.prisma.message.create({
    data: {
      id: messageId,
      fleetId,
      senderShipId: argoId,
      selectorKind: 'ship',
      selectorShipId: argoId,
      payload: '{}',
      contentType: 'application/json',
      idempotencyKey: messageId,
      requestHash: messageId,
      createdAt: core.clock.now(),
    },
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
      claimedByLeaseId: lease.id,
      attempts: 1,
      createdAt: core.clock.now(),
    },
  });
  return deliveryId;
}

describe('signing in on Postgres', () => {
  it('stores the session by token hash and a lease from the web console', async () => {
    const { token, consoleSessionId } = unwrap(await core.useCases.signIn(OPERATOR));

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
    const first = unwrap(await core.useCases.signIn(OPERATOR));
    const deliveryId = await deliveryInFlightToArgo();

    const second = unwrap(await core.useCases.signIn(OPERATOR));

    await expect(core.useCases.authenticate.byConsoleSession(first.token)).resolves.toBeUndefined();
    await expect(core.useCases.authenticate.byConsoleSession(second.token)).resolves.toMatchObject({ caller: { shipId: argoId } });
    await expect(liveSessions()).resolves.toEqual([expect.objectContaining({ id: second.consoleSessionId })]);
    await expect(openLeases()).resolves.toHaveLength(1);
    await expect(core.prisma.delivery.findUnique({ where: { id: deliveryId } })).resolves.toMatchObject({
      state: 'pending',
      claimedByShipId: null,
      claimedByLeaseId: null,
    });
    await expect(eventTypes()).resolves.toEqual(['ShipClaimed', 'LeaseRevoked', 'DeliveryReturned', 'ShipClaimed']);
  });

  it('serialises concurrent sign-ins: every one succeeds, one session and one lease stay', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => core.useCases.signIn(OPERATOR)));

    expect(results.map((result) => result.isOk)).toEqual([true, true, true, true, true]);
    await expect(liveSessions()).resolves.toHaveLength(1);
    await expect(openLeases()).resolves.toHaveLength(1);
    const types = await eventTypes();
    expect(types.filter((type) => type === 'ShipClaimed')).toHaveLength(5);
    expect(types.filter((type) => type === 'LeaseRevoked')).toHaveLength(4);
  });

  it('refuses a wrong email and a wrong password with the very same error, and writes nothing', async () => {
    const wrongEmail = await core.useCases.signIn({ email: 'stranger@example.com', password: OPERATOR.password });
    const wrongPassword = await core.useCases.signIn({ email: OPERATOR.email, password: 'wrong horse' });

    expect(wrongEmail).toEqual({
      isOk: false,
      error: { kind: 'WRONG_EMAIL_OR_PASSWORD', message: 'Wrong email or password' },
    });
    expect(wrongPassword).toEqual(wrongEmail);
    await expect(liveSessions()).resolves.toEqual([]);
    await expect(openLeases()).resolves.toEqual([]);
    await expect(eventTypes()).resolves.toEqual([]);
  });

  it('finds the email in capitals and with spaces around it', async () => {
    await expect(
      core.useCases.signIn({ email: `  ${OPERATOR.email.toUpperCase()} `, password: OPERATOR.password }),
    ).resolves.toMatchObject({ isOk: true, value: { caller: { shipId: argoId, fleetId } } });
  });

  it('checks a password while another transaction holds the account: a wrong one is refused at once', async () => {
    const { promise: held, resolve: release } = Promise.withResolvers<undefined>();
    const { promise: locked, resolve: signalLocked } = Promise.withResolvers<undefined>();
    const holder = createPrismaUnitOfWork(core.prisma).run(async (tx) => {
      await tx.operatorAccounts.findByEmailForUpdate(OPERATOR.email);
      signalLocked(undefined);
      await held;
      return ok(undefined);
    });
    await locked;

    const outcome = await Promise.race([
      core.useCases.signIn({ email: OPERATOR.email, password: 'wrong horse' }),
      new Promise((resolve) => setTimeout(resolve, 3_000, 'still waiting for the account')),
    ]);
    release(undefined);
    await holder;

    expect(outcome).toMatchObject({ isOk: false, error: { kind: 'WRONG_EMAIL_OR_PASSWORD' } });
  });

  it('leaves the first session and lease untouched when a sign-in fails halfway', async () => {
    const first = unwrap(await core.useCases.signIn(OPERATOR));
    const failingUow = createPrismaUnitOfWork(core.prisma);
    const signIn = createSignIn({
      accounts: createPrismaOperatorAccountLookup(core.prisma),
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
      passwords: argon2idPasswordHasher,
    });

    await expect(signIn(OPERATOR)).rejects.toThrow('disk full');

    await expect(core.useCases.authenticate.byConsoleSession(first.token)).resolves.toMatchObject({ caller: { shipId: argoId } });
    await expect(liveSessions()).resolves.toEqual([expect.objectContaining({ id: first.consoleSessionId })]);
    await expect(openLeases()).resolves.toHaveLength(1);
    await expect(eventTypes()).resolves.toEqual(['ShipClaimed']);
  });
});

describe('a console session on Postgres', () => {
  it('expires 30 days after its last use, and each use moves that', async () => {
    const { token } = unwrap(await core.useCases.signIn(OPERATOR));
    core.clock.advance(29 * DAY_MS);
    await expect(core.useCases.authenticate.byConsoleSession(token)).resolves.toBeDefined();
    core.clock.advance(30 * DAY_MS - 1);
    await expect(core.useCases.authenticate.byConsoleSession(token)).resolves.toBeDefined();

    core.clock.advance(30 * DAY_MS);

    await expect(core.useCases.authenticate.byConsoleSession(token)).resolves.toBeUndefined();
  });

  it('survives a server restart: a new client finds it', async () => {
    const { token } = unwrap(await core.useCases.signIn(OPERATOR));
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
    const { token, caller } = unwrap(await core.useCases.signIn(OPERATOR));
    const deliveryId = await deliveryInFlightToArgo();

    await core.useCases.signOut(caller);

    await expect(core.useCases.authenticate.byConsoleSession(token)).resolves.toBeUndefined();
    await expect(liveSessions()).resolves.toEqual([]);
    await expect(openLeases()).resolves.toEqual([]);
    await expect(core.prisma.delivery.findUnique({ where: { id: deliveryId } })).resolves.toMatchObject({ state: 'pending' });
    await expect(eventTypes()).resolves.toEqual(['ShipClaimed', 'LeaseRevoked', 'DeliveryReturned']);
  });
});

describe('resetting the operator password on Postgres', () => {
  const NEW_PASSWORD = 'staple battery horse correct';

  it("writes OperatorPasswordReset on argo's timeline", async () => {
    unwrap(await core.useCases.resetOperatorPassword({ fleetId, password: NEW_PASSWORD }));

    await expect(core.prisma.event.findMany({ where: { type: 'OperatorPasswordReset' } })).resolves.toEqual([
      expect.objectContaining({ shipId: argoId, actorShipId: null }),
    ]);
  });

  it('makes the old password fail and the new one sign in, ends every session and the lease', async () => {
    const { token } = unwrap(await core.useCases.signIn(OPERATOR));

    unwrap(await core.useCases.resetOperatorPassword({ fleetId, password: NEW_PASSWORD }));

    await expect(core.useCases.authenticate.byConsoleSession(token)).resolves.toBeUndefined();
    await expect(liveSessions()).resolves.toEqual([]);
    await expect(openLeases()).resolves.toEqual([]);
    await expect(eventTypes()).resolves.toEqual(['ShipClaimed', 'OperatorPasswordReset', 'LeaseRevoked']);
    await expect(core.useCases.signIn(OPERATOR)).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'WRONG_EMAIL_OR_PASSWORD' },
    });
    await expect(core.useCases.signIn({ email: OPERATOR.email, password: NEW_PASSWORD })).resolves.toMatchObject({
      isOk: true,
      value: { caller: { shipId: argoId } },
    });
  });

  it('stores the new password as an Argon2id hash only', async () => {
    unwrap(await core.useCases.resetOperatorPassword({ fleetId, password: NEW_PASSWORD }));

    const account = await core.prisma.operator.findFirstOrThrow({ where: { fleetId } });
    expect(account.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(argon2idPasswordHasher.verify(NEW_PASSWORD, account.passwordHash)).resolves.toBe(true);
  });

  it('never lets a concurrent sign-in with the old password outlive the reset', async () => {
    const [signIn, reset] = await Promise.all([
      core.useCases.signIn(OPERATOR),
      core.useCases.resetOperatorPassword({ fleetId, password: NEW_PASSWORD }),
    ]);

    expect(reset.isOk).toBe(true);
    if (signIn.isOk) {
      await expect(core.useCases.authenticate.byConsoleSession(signIn.value.token)).resolves.toBeUndefined();
    } else {
      expect(signIn.error).toMatchObject({ kind: 'WRONG_EMAIL_OR_PASSWORD' });
    }
    await expect(liveSessions()).resolves.toEqual([]);
    await expect(openLeases()).resolves.toEqual([]);
  });
});

describe('the caller lookups', () => {
  const UNKNOWN_CREW_TOKEN = { isOk: false, error: { kind: 'UNKNOWN_CREW_TOKEN' } };

  async function claimedScout(): Promise<{ shipId: ShipId; secret: string; crewToken: string }> {
    const argo = { shipId: argoId, fleetId, kind: 'operator' as const, scopes: [...SCOPES] };
    const { shipId, prompt } = unwrap(await core.useCases.commissionShip(argo, { name: 'scout', type: 'reviewer' }));
    const secret = secretIn(prompt);
    const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret, location: { kind: 'DEVICE' } }));
    return { shipId, secret, crewToken };
  }

  it("find the ship, fleet, kind and scopes, and the crew's lease, by crew token hash alone", async () => {
    const { shipId, crewToken } = await claimedScout();
    const lease = await core.prisma.lease.findFirstOrThrow({ where: { shipId, endedAt: null } });

    expect(unwrap(await core.useCases.authenticate.byCrewToken(crewToken))).toEqual({
      shipId,
      fleetId,
      kind: 'agent',
      scopes: ['messages:send', 'messages:receive'],
      leaseId: lease.id,
    });
  });

  it('know no crew token of another length or content, and take neither the secret nor a crew token for the other', async () => {
    const { secret, crewToken } = await claimedScout();

    await expect(core.useCases.authenticate.byCrewToken(`${crewToken}x`)).resolves.toMatchObject(UNKNOWN_CREW_TOKEN);
    await expect(core.useCases.authenticate.byCrewToken(secret)).resolves.toMatchObject(UNKNOWN_CREW_TOKEN);
    await expect(core.useCases.authenticate.byConsoleSession(crewToken)).resolves.toBeUndefined();
  });

  it('refuse a crew token whose lease has ended as LEASE_ENDED', async () => {
    const { shipId, crewToken } = await claimedScout();
    await core.prisma.lease.updateMany({ where: { shipId }, data: { endedAt: core.clock.now() } });

    await expect(core.useCases.authenticate.byCrewToken(crewToken)).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'LEASE_ENDED' },
    });
  });

  it('know no crew token of a retired ship', async () => {
    const { shipId, crewToken } = await claimedScout();
    // Retiring arrives with a later slice.
    await core.prisma.ship.update({ where: { id: shipId }, data: { retiredAt: core.clock.now() } });

    await expect(core.useCases.authenticate.byCrewToken(crewToken)).resolves.toMatchObject(UNKNOWN_CREW_TOKEN);
  });
});
