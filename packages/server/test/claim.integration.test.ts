import { createIdGenerator, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cryptoRandomTokens, sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createClaimShip } from '../src/core/registry/claim-ship.js';
import { createGetStartingPrompt } from '../src/core/registry/get-starting-prompt.js';
import type { Caller } from '../src/core/shared/caller.js';
import type { UnitOfWork } from '../src/core/shared/unit-of-work.js';
import { FLEET_MCP_URL, OPERATOR, operatorCaller, secretIn } from './support/core-fixtures.js';
import {
  createPostgresCore,
  everyRow,
  heldUnitOfWork,
  racingUnitOfWork,
  type PostgresCore,
} from './support/postgres-core.js';
import { unwrap } from './support/result.js';

// Claiming a ship on a real Postgres through the Prisma adapters: what a claim
// stores and writes, its lock order against concurrent claims and against a
// new starting prompt, and rollback.

const newId = createIdGenerator();
const onDevice = { kind: 'DEVICE' } as const;

let core: PostgresCore;
let fleetId: FleetId;
let argoId: ShipId;
let argo: Caller;
let scoutId: ShipId;
let scoutSecret: string;

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  const commissioned = unwrap(await core.useCases.commissionShip(argo, { name: 'scout', type: 'reviewer' }));
  scoutId = commissioned.shipId;
  scoutSecret = secretIn(commissioned.prompt);
  core.clock.advance(60_000);
});

afterEach(async () => {
  await core.close();
});

function claimShipWith(uow: UnitOfWork<PrismaTx>) {
  return createClaimShip({
    uow,
    clock: core.clock,
    ids: newId,
    secrets: { hasher: sha256Hasher, random: cryptoRandomTokens },
  });
}

function getStartingPromptWith(uow: UnitOfWork<PrismaTx>) {
  return createGetStartingPrompt({
    uow,
    clock: core.clock,
    ids: newId,
    secrets: { hasher: sha256Hasher, random: cryptoRandomTokens },
    mcpUrl: FLEET_MCP_URL,
  });
}

/** The ports with the lease lookup held: by then the transaction holds the secret's lock. */
function holdingAtTheLease(tx: PrismaTx, hold: () => Promise<void>): PrismaTx {
  return {
    ...tx,
    leases: {
      ...tx.leases,
      findOpenForUpdate: async (fleet, ship) => {
        await hold();
        return tx.leases.findOpenForUpdate(fleet, ship);
      },
    },
  };
}

function openLeasesOfScout() {
  return core.prisma.lease.findMany({ where: { shipId: scoutId, endedAt: null } });
}

function credentialsOfScout() {
  return core.prisma.credential.findMany({ where: { shipId: scoutId }, orderBy: { id: 'asc' } });
}

describe('claiming a ship on Postgres', () => {
  it('stores a lease at the reported location with only the hash of the crew token, and marks the secret claimed', async () => {
    const { crewToken } = unwrap(
      await core.useCases.claimShip({
        shipId: scoutId,
        secret: scoutSecret,
        location: { kind: 'OTHER', description: 'a ci runner' },
      }),
    );

    const [lease] = await openLeasesOfScout();
    expect(lease?.id).toMatch(/^lse_/);
    await expect(openLeasesOfScout()).resolves.toEqual([
      {
        id: lease?.id,
        fleetId,
        shipId: scoutId,
        location: 'OTHER',
        locationDescription: 'a ci runner',
        crewTokenHash: sha256Hasher.hash(crewToken),
        startedAt: core.clock.now(),
        endedAt: null,
      },
    ]);
    await expect(credentialsOfScout()).resolves.toEqual([
      expect.objectContaining({ claimedAt: core.clock.now(), invalidatedAt: null }),
    ]);
  });

  it('writes ShipClaimed with the location, caused by the ship itself', async () => {
    unwrap(await core.useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: onDevice }));

    const [lease] = await openLeasesOfScout();
    const claimed = await core.prisma.event.findMany({ where: { type: 'ShipClaimed', shipId: scoutId } });
    expect(claimed).toEqual([
      expect.objectContaining({
        fleetId,
        occurredAt: core.clock.now(),
        actorShipId: scoutId,
        details: { leaseId: lease?.id, location: 'DEVICE', locationDescription: null },
      }),
    ]);
  });

  it('keeps the crew token out of every table', async () => {
    const { crewToken } = unwrap(
      await core.useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: onDevice }),
    );

    const rows = await everyRow(core.prisma);

    expect(rows).toContain(sha256Hasher.hash(crewToken));
    expect(rows).not.toContain(crewToken);
  });

  it('refuses the secret a new starting prompt replaced', async () => {
    unwrap(await core.useCases.getStartingPrompt(argo, { shipId: scoutId }));

    await expect(
      core.useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: onDevice }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'WRONG_SHIP_ID_OR_SECRET' } });
  });

  it('refuses a retired ship that still holds a valid secret', async () => {
    // Retiring, which also revokes the secret, arrives with a later slice.
    await core.prisma.ship.update({ where: { id: scoutId }, data: { retiredAt: core.clock.now() } });

    await expect(
      core.useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: onDevice }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_NOT_AWAITING_CREW' } });
    await expect(openLeasesOfScout()).resolves.toEqual([]);
  });

  it('refuses argo, even with a secret stored for it', async () => {
    const secret = `aeolus_sk_v1_${newId('credential')}`;
    await core.prisma.credential.create({
      data: { id: newId('credential'), fleetId, shipId: argoId, secretHash: sha256Hasher.hash(secret), issuedAt: core.clock.now() },
    });

    await expect(core.useCases.claimShip({ shipId: argoId, secret, location: onDevice })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'OPERATOR_SHIP_HAS_NO_SECRET' },
    });
  });

  it('gives five concurrent claims with one secret exactly one lease; every other claim is refused', async () => {
    const claimShip = claimShipWith(
      racingUnitOfWork({ prisma: core.prisma, transactions: 5 }, (tx, allArrived) => ({
        ...tx,
        credentials: {
          ...tx.credentials,
          findValidBySecretHashForUpdate: async (secretHash) => {
            await allArrived();
            return tx.credentials.findValidBySecretHashForUpdate(secretHash);
          },
        },
      })),
    );

    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimShip({ shipId: scoutId, secret: scoutSecret, location: onDevice })),
    );

    expect(results.map((result) => (result.isOk ? 'claimed' : result.error.kind)).sort()).toEqual([
      'SHIP_NOT_AWAITING_CREW',
      'SHIP_NOT_AWAITING_CREW',
      'SHIP_NOT_AWAITING_CREW',
      'SHIP_NOT_AWAITING_CREW',
      'claimed',
    ]);
    const [winner] = results.flatMap((result) => (result.isOk ? [result.value.crewToken] : []));
    await expect(openLeasesOfScout()).resolves.toEqual([
      expect.objectContaining({ crewTokenHash: sha256Hasher.hash(winner ?? '') }),
    ]);
  });

  it('lets a claim that holds the secret first win over a new starting prompt, which is refused', async () => {
    const { uow, reached } = heldUnitOfWork(core.prisma, holdingAtTheLease);
    const claim = claimShipWith(uow)({ shipId: scoutId, secret: scoutSecret, location: onDevice });
    await reached;

    const prompt = core.useCases.getStartingPrompt(argo, { shipId: scoutId });

    await expect(claim).resolves.toMatchObject({ isOk: true });
    await expect(prompt).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_NOT_AWAITING_CREW' } });
    await expect(credentialsOfScout()).resolves.toEqual([
      expect.objectContaining({ secretHash: sha256Hasher.hash(scoutSecret), invalidatedAt: null, claimedAt: core.clock.now() }),
    ]);
    await expect(openLeasesOfScout()).resolves.toHaveLength(1);
  });

  it('lets a new starting prompt that holds the secret first win over a claim, which is refused', async () => {
    const { uow, reached } = heldUnitOfWork(core.prisma, holdingAtTheLease);
    const prompt = getStartingPromptWith(uow)(argo, { shipId: scoutId });
    await reached;

    const claim = core.useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: onDevice });

    await expect(prompt).resolves.toMatchObject({ isOk: true });
    await expect(claim).resolves.toMatchObject({ isOk: false, error: { kind: 'WRONG_SHIP_ID_OR_SECRET' } });
    await expect(openLeasesOfScout()).resolves.toEqual([]);
    await expect(credentialsOfScout()).resolves.toEqual([
      expect.objectContaining({ secretHash: sha256Hasher.hash(scoutSecret), invalidatedAt: core.clock.now() }),
      expect.objectContaining({ invalidatedAt: null, claimedAt: null }),
    ]);
  });

  it('lets a claim win over a new starting prompt that holds the ship but not yet the secret, without a deadlock', async () => {
    // The prompt holds the ship FOR NO KEY UPDATE and waits for the secret the
    // claim holds. A claim that locked the ship as well would wait for the
    // prompt in turn: a deadlock. Reading the ship without a lock avoids it.
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      credentials: {
        ...tx.credentials,
        findValidForShipForUpdate: async (fleet, ship) => {
          await hold();
          return tx.credentials.findValidForShipForUpdate(fleet, ship);
        },
      },
    }));
    const prompt = getStartingPromptWith(uow)(argo, { shipId: scoutId });
    await reached;

    const claim = core.useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: onDevice });

    await expect(claim).resolves.toMatchObject({ isOk: true });
    await expect(prompt).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_NOT_AWAITING_CREW' } });
    await expect(openLeasesOfScout()).resolves.toHaveLength(1);
  });

  it('leaves no lease and the secret unclaimed when a write fails halfway', async () => {
    const before = await everyRow(core.prisma);
    const uow = createPrismaUnitOfWork(core.prisma);
    const claimShip = claimShipWith({
      run: (work) => uow.run((tx) => work({ ...tx, events: { append: () => Promise.reject(new Error('disk full')) } })),
    });

    await expect(claimShip({ shipId: scoutId, secret: scoutSecret, location: onDevice })).rejects.toThrow('disk full');

    await expect(everyRow(core.prisma)).resolves.toBe(before);
  });
});
