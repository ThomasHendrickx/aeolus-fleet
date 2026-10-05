import { createIdGenerator, idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cryptoRandomTokens, sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createCommissionShip } from '../src/core/registry/commission-ship.js';
import { createGetStartingPrompt } from '../src/core/registry/get-starting-prompt.js';
import type { Caller } from '../src/core/shared/caller.js';
import { OPERATOR, operatorCaller, secretOf } from './support/core-fixtures.js';
import { createPostgresCore, everyRow, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// The fleet use cases on a real Postgres through the Prisma adapters: what a
// commission stores, which events it writes, the name rules under concurrency,
// and rollback.

const newId = createIdGenerator();

let core: PostgresCore;
let fleetId: FleetId;
let argoId: ShipId;
let argo: Caller;

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
});

afterEach(async () => {
  await core.close();
});

/** Every event about the ship, oldest first, as type, acting ship and details. */
async function eventsAbout(shipId: ShipId) {
  const events = await core.prisma.event.findMany({ where: { shipId }, orderBy: { id: 'asc' } });
  return events.map((event) => [event.type, event.actorShipId, event.details]);
}

/** The ship a secret is valid for, the one it claims; undefined once the secret is invalid. */
async function shipOfValidSecret(secret: string): Promise<string | undefined> {
  const credential = await core.prisma.credential.findFirst({
    where: { secretHash: sha256Hasher.hash(secret), invalidatedAt: null },
  });
  return credential?.shipId;
}

async function shipsNamed(name: string) {
  return core.prisma.ship.findMany({ where: { fleetId, name }, orderBy: { id: 'asc' } });
}

describe('commissioning a ship on Postgres', () => {
  it('stores an agent ship awaiting crew and the hash of its first secret', async () => {
    const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: 'commission-scout', name: 'scout', type: 'reviewer', note: 'reviews pull requests' }),
    );

    await expect(core.prisma.ship.findUnique({ where: { id: shipId } })).resolves.toEqual({
      id: shipId,
      fleetId,
      name: 'scout',
      type: 'reviewer',
      kind: 'agent',
      scopes: ['messages:send', 'messages:receive'],
      note: 'reviews pull requests',
      createdAt: core.clock.now(),
      retiredAt: null,
      commissionedBy: argoId,
      commissionKey: 'commission-scout',
      commissionRequestHash: (await core.prisma.ship.findUnique({ where: { id: shipId } }))?.commissionRequestHash ?? 'none',
    });
    await expect(core.prisma.credential.findMany({ where: { shipId } })).resolves.toEqual([
      expect.objectContaining({
        secretHash: sha256Hasher.hash(secretOf(secret)),
        issuedAt: core.clock.now(),
        claimedAt: null,
        invalidatedAt: null,
      }),
    ]);
    await expect(core.prisma.lease.count({ where: { shipId } })).resolves.toBe(0);
  });

  it('writes ShipCommissioned and StartingPromptIssued in the same transaction, caused by argo', async () => {
    const { shipId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const credential = await core.prisma.credential.findFirst({ where: { shipId } });

    await expect(eventsAbout(shipId)).resolves.toEqual([
      ['ShipCommissioned', argoId, { name: 'scout', type: 'reviewer', kind: 'agent', scopes: 'messages:send messages:receive' }],
      ['StartingPromptIssued', argoId, { credentialId: credential?.id }],
    ]);
  });

  it('keeps the secret out of every table', async () => {
    const { secret } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    const rows = await everyRow(core.prisma);

    expect(rows).toContain(sha256Hasher.hash(secretOf(secret)));
    expect(rows).not.toContain(secretOf(secret));
  });

  it('refuses a name an active ship holds', async () => {
    unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    await expect(core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'lookout' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NAME_TAKEN' },
    });
    await expect(shipsNamed('scout')).resolves.toHaveLength(1);
  });

  it("reuses a retired ship's name", async () => {
    const first = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    // Retiring arrives with a later slice.
    await core.prisma.ship.update({ where: { id: first.shipId }, data: { retiredAt: core.clock.now() } });

    const second = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    await expect(shipsNamed('scout')).resolves.toEqual([
      expect.objectContaining({ id: first.shipId, retiredAt: core.clock.now() }),
      expect.objectContaining({ id: second.shipId, retiredAt: null }),
    ]);
  });

  it('refuses argo as a name', async () => {
    await expect(core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'argo', type: 'reviewer' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NAME_RESERVED' },
    });
  });

  it('serialises concurrent commissions of one name: one ship, every other one refused', async () => {
    const commissionShip = createCommissionShip({
      uow: racingUnitOfWork({ prisma: core.prisma, transactions: 5 }, (tx, allArrived) => ({
        ...tx,
        ships: {
          ...tx.ships,
          findActiveByName: async (fleet, name) => {
            await allArrived();
            return tx.ships.findActiveByName(fleet, name);
          },
        },
      })),
      clock: core.clock,
      ids: newId,
      secrets: { hasher: sha256Hasher, random: cryptoRandomTokens },
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })),
    );

    expect(results.map((result) => (result.isOk ? 'commissioned' : result.error.kind)).sort()).toEqual([
      'SHIP_NAME_TAKEN',
      'SHIP_NAME_TAKEN',
      'SHIP_NAME_TAKEN',
      'SHIP_NAME_TAKEN',
      'commissioned',
    ]);
    const [scout] = await shipsNamed('scout');
    await expect(core.prisma.credential.count({ where: { shipId: scout?.id } })).resolves.toBe(1);
  });

  it('makes one ship of five commissions with one key at once, each answered with its id', async () => {
    const request = { idempotencyKey: 'commission-scout', name: 'scout', type: 'reviewer' };

    const results = await Promise.all(Array.from({ length: 5 }, () => core.useCases.commissionShip(argo, request)));

    const shipIds = results.map((result) => unwrap(result).shipId);
    expect(new Set(shipIds).size).toBe(1);
    expect(results.filter((result) => result.isOk && result.value.secret !== null)).toHaveLength(1);
    await expect(shipsNamed('scout')).resolves.toHaveLength(1);
    await expect(core.prisma.credential.count({ where: { shipId: shipIds[0] } })).resolves.toBe(1);
  });

  it('commissions different names concurrently', async () => {
    const names = ['scout', 'lookout', 'pilot'];

    const results = await Promise.all(
      names.map((name) => core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' })),
    );

    expect(results.map((result) => result.isOk)).toEqual([true, true, true]);
  });

  it('leaves no ship, secret or event behind when a write fails halfway', async () => {
    const before = await everyRow(core.prisma);
    const uow = createPrismaUnitOfWork(core.prisma);
    const commissionShip = createCommissionShip({
      uow: {
        run: (work) =>
          uow.run((tx) =>
            work({ ...tx, events: { append: () => Promise.reject(new Error('disk full')) } }),
          ),
      },
      clock: core.clock,
      ids: newId,
      secrets: { hasher: sha256Hasher, random: cryptoRandomTokens },
    });

    await expect(commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })).rejects.toThrow('disk full');

    await expect(everyRow(core.prisma)).resolves.toBe(before);
  });
});

describe('getting a starting prompt on Postgres', () => {
  let scoutId: ShipId;
  let firstSecret: string;

  beforeEach(async () => {
    const commissioned = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    scoutId = commissioned.shipId;
    firstSecret = secretOf(commissioned.secret);
    core.clock.advance(60_000);
  });

  async function validSecretsOfScout() {
    return core.prisma.credential.findMany({ where: { shipId: scoutId, invalidatedAt: null } });
  }

  it('replaces the secret: the previous one fails on the very next call, the new one works', async () => {
    const { secret } = unwrap(await core.useCases.getStartingPrompt(argo, { shipId: scoutId }));

    await expect(shipOfValidSecret(firstSecret)).resolves.toBeUndefined();
    await expect(shipOfValidSecret(secretOf(secret))).resolves.toBe(scoutId);
    await expect(validSecretsOfScout()).resolves.toEqual([
      expect.objectContaining({ secretHash: sha256Hasher.hash(secretOf(secret)), issuedAt: core.clock.now() }),
    ]);
  });

  it('writes CredentialRevoked and StartingPromptIssued in the same transaction, caused by argo', async () => {
    const [previous] = await validSecretsOfScout();

    unwrap(await core.useCases.getStartingPrompt(argo, { shipId: scoutId }));

    const [issued] = await validSecretsOfScout();
    await expect(eventsAbout(scoutId)).resolves.toEqual([
      ['ShipCommissioned', argoId, { name: 'scout', type: 'reviewer', kind: 'agent', scopes: 'messages:send messages:receive' }],
      ['StartingPromptIssued', argoId, { credentialId: previous?.id }],
      ['CredentialRevoked', argoId, { credentialId: previous?.id }],
      ['StartingPromptIssued', argoId, { credentialId: issued?.id }],
    ]);
  });

  it('keeps the new secret out of every table', async () => {
    const { secret } = unwrap(await core.useCases.getStartingPrompt(argo, { shipId: scoutId }));

    await expect(everyRow(core.prisma)).resolves.not.toContain(secretOf(secret));
  });

  it('is refused while a session crews the ship', async () => {
    unwrap(await core.useCases.claimShip({ shipId: scoutId, secret: firstSecret, location: { kind: 'DEVICE' }, harness: 'claude-code' }));

    await expect(core.useCases.getStartingPrompt(argo, { shipId: scoutId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_AWAITING_CREW' },
    });
    await expect(shipOfValidSecret(firstSecret)).resolves.toBe(scoutId);
  });

  it('is refused for argo', async () => {
    await expect(core.useCases.getStartingPrompt(argo, { shipId: argoId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'OPERATOR_SHIP_GETS_NO_STARTING_PROMPT' },
    });
  });

  it('keeps exactly one valid secret under concurrent prompts, the last one issued', async () => {
    const getStartingPrompt = createGetStartingPrompt({
      uow: racingUnitOfWork({ prisma: core.prisma, transactions: 5 }, (tx, allArrived) => ({
        ...tx,
        credentials: {
          ...tx.credentials,
          findValidForShipForUpdate: async (fleet, ship) => {
            await allArrived();
            return tx.credentials.findValidForShipForUpdate(fleet, ship);
          },
        },
      })),
      clock: core.clock,
      ids: newId,
      secrets: { hasher: sha256Hasher, random: cryptoRandomTokens },
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => getStartingPrompt(argo, { shipId: scoutId })),
    );

    expect(results.map((result) => result.isOk)).toEqual([true, true, true, true, true]);
    const valid = await validSecretsOfScout();
    expect(valid).toHaveLength(1);
    const secrets = results.flatMap((result) => (result.isOk ? [result.value.secret] : []));
    const working = await Promise.all(secrets.map((secret) => shipOfValidSecret(secret)));
    expect(working.filter((shipId) => shipId !== undefined)).toHaveLength(1);
  });

  it('leaves the previous secret valid when a write fails halfway', async () => {
    const before = await everyRow(core.prisma);
    const uow = createPrismaUnitOfWork(core.prisma);
    const getStartingPrompt = createGetStartingPrompt({
      uow: {
        run: (work) =>
          uow.run((tx) => work({ ...tx, events: { append: () => Promise.reject(new Error('disk full')) } })),
      },
      clock: core.clock,
      ids: newId,
      secrets: { hasher: sha256Hasher, random: cryptoRandomTokens },
    });

    await expect(getStartingPrompt(argo, { shipId: scoutId })).rejects.toThrow('disk full');

    await expect(everyRow(core.prisma)).resolves.toBe(before);
    await expect(shipOfValidSecret(firstSecret)).resolves.toBe(scoutId);
  });
});

describe('getting one ship on Postgres', () => {
  it('gives the ship with when it was commissioned, since when its crew has held it, and no retirement', async () => {
    const commissionedAt = core.clock.now();
    const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    core.clock.advance(60_000);
    const crewedAt = core.clock.now();
    unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'SERVER' }, harness: 'claude-code' }));

    await expect(core.useCases.getShip(argo, { shipId })).resolves.toEqual({
      isOk: true,
      value: {
        id: shipId,
        name: 'scout',
        type: 'reviewer',
        kind: 'agent',
        status: 'crewed',
        startingPrompt: { issuedAt: commissionedAt, isClaimed: true },
        location: { kind: 'SERVER', description: null },
        lastSeenAt: crewedAt,
        ping: null,
        scopes: ['messages:send', 'messages:receive'],
        report: null,
        harness: 'claude-code',
        model: null,
        awaitingCrewSince: null,
        commissionedAt,
        crewedSince: crewedAt,
        retiredAt: null,
        inFlightDeliveries: 0,
        openDeliveries: 0,
      },
    });
  });

  it('knows no ship of another fleet', async () => {
    const { shipId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    await expect(core.useCases.getShip({ ...argo, fleetId: newId('fleet') }, { shipId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
  });
});

describe('listing the fleet on Postgres', () => {
  it('shows the harness of the session crewing a ship and the last model its sessions stated', async () => {
    const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
    const crew = unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
    core.clock.advance(60_000);
    unwrap(
      await core.useCases.sendMessage(crew, { selector: { kind: 'ship', name: 'argo' }, payload: 'Done', model: 'claude-opus-5-5', idempotencyKey: newKey() }),
    );

    const listed = (await core.useCases.listFleet(argo)).find((ship) => ship.id === shipId);
    expect(listed).toMatchObject({ harness: 'claude-code', model: { id: 'claude-opus-5-5', statedAt: core.clock.now() } });
  });

  it("keeps the last model a ship's sessions stated when the operator resends an older message of the ship's", async () => {
    const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
    const crew = unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
    const send = async (model: string) =>
      unwrap(await core.useCases.sendMessage(crew, { selector: { kind: 'ship', name: 'argo' }, payload: 'Done', model, idempotencyKey: newKey() })).messageId;
    const older = await send('claude-sonnet-5-5');
    await core.prisma.delivery.updateMany({ where: { messageId: older }, data: { state: 'undeliverable' } });
    const { id: deliveryId } = await core.prisma.delivery.findFirstOrThrow({ where: { messageId: older } });
    core.clock.advance(60_000);
    await send('claude-opus-5-5');
    const statedAt = core.clock.now();
    core.clock.advance(60_000);

    unwrap(await core.useCases.resendDelivery(argo, { deliveryId: idSchema('delivery').parse(deliveryId) }));

    const listed = (await core.useCases.listFleet(argo)).find((ship) => ship.id === shipId);
    expect(listed?.model).toEqual({ id: 'claude-opus-5-5', statedAt });
  });

  it('lists argo and a commissioned ship with their status and prompt state', async () => {
    const commissionedAt = core.clock.now();
    const { shipId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    core.clock.advance(60_000);
    const signedInAt = core.clock.now();
    unwrap(await core.useCases.signIn(OPERATOR));

    await expect(core.useCases.listFleet(argo)).resolves.toEqual([
      {
        id: argoId,
        name: 'argo',
        type: 'operator',
        kind: 'operator',
        status: 'crewed',
        startingPrompt: null,
        location: { kind: 'OTHER', description: 'Unknown device' },
        lastSeenAt: signedInAt,
        ping: null,
        scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'],
        report: null,
        harness: null,
        model: null,
        awaitingCrewSince: null,
        retiredAt: null,
      },
      {
        id: shipId,
        name: 'scout',
        type: 'reviewer',
        kind: 'agent',
        status: 'awaitingCrew',
        startingPrompt: { issuedAt: commissionedAt, isClaimed: false },
        location: null,
        lastSeenAt: null,
        ping: null,
        scopes: ['messages:send', 'messages:receive'],
        report: null,
        harness: null,
        model: null,
        awaitingCrewSince: commissionedAt,
        retiredAt: null,
      },
    ]);
  });

  it('shows a released ship awaiting crew since its release, not its commission', async () => {
    const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
    core.clock.advance(60_000);
    const releasedAt = core.clock.now();

    unwrap(await core.useCases.releaseShip(argo, { shipId }));

    const listed = (await core.useCases.listFleet(argo)).find((ship) => ship.id === shipId);
    expect(listed).toMatchObject({ status: 'awaitingCrew', awaitingCrewSince: releasedAt });
  });

  it('shows the newest prompt after a new one replaced the first', async () => {
    const { shipId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    core.clock.advance(60_000);

    unwrap(await core.useCases.getStartingPrompt(argo, { shipId }));

    const listed = await core.useCases.listFleet(argo);
    expect(listed.find((ship) => ship.id === shipId)?.startingPrompt).toEqual({
      issuedAt: core.clock.now(),
      isClaimed: false,
    });
  });

  it('shows a crewed ship and a retired one, the retired one without a prompt once its secret is gone', async () => {
    const crewed = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const retired = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' }));
    unwrap(
      await core.useCases.claimShip({ shipId: crewed.shipId, secret: secretOf(crewed.secret), location: { kind: 'SERVER' }, harness: 'claude-code' }),
    );
    // Retiring arrives with a later slice.
    await core.prisma.ship.update({ where: { id: retired.shipId }, data: { retiredAt: core.clock.now() } });
    await core.prisma.credential.updateMany({
      where: { shipId: retired.shipId },
      data: { invalidatedAt: core.clock.now() },
    });

    const listed = await core.useCases.listFleet(argo);

    expect(listed.find((ship) => ship.name === 'lookout')?.retiredAt).toEqual(core.clock.now());
    expect(listed.map((ship) => [ship.name, ship.status, ship.startingPrompt?.isClaimed ?? null, ship.location])).toEqual([
      ['argo', 'crewed', null, null],
      ['scout', 'crewed', true, { kind: 'SERVER', description: null }],
      ['lookout', 'retired', null, null],
    ]);
  });

  it("lists only the caller's fleet", async () => {
    const otherFleet = newId('fleet');
    await core.prisma.fleet.create({ data: { id: otherFleet, name: 'other fleet', createdAt: core.clock.now() } });
    await core.prisma.ship.create({
      data: {
        id: newId('ship'),
        fleetId: otherFleet,
        name: 'stranger',
        type: 'reviewer',
        kind: 'agent',
        scopes: ['messages:send'],
        createdAt: core.clock.now(),
      },
    });

    const listed = await core.useCases.listFleet(argo);

    expect(listed.map((ship) => ship.name)).toEqual(['argo']);
  });

  it('never carries a secret or its hash', async () => {
    const { secret } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    const listed = JSON.stringify(await core.useCases.listFleet(argo));

    expect(listed).not.toContain(secretOf(secret));
    expect(listed).not.toContain(sha256Hasher.hash(secretOf(secret)));
  });
});
