import { createIdGenerator, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createCommissionShip } from '../src/core/registry/commission-ship.js';
import type { Caller } from '../src/core/shared/caller.js';
import { FLEET_URL, operatorCaller, secretIn } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';

// The fleet use cases on a real Postgres through the Prisma adapters: what a
// commission stores, which events it writes, the name rules under concurrency,
// and rollback.

const newId = createIdGenerator();
const TABLES = ['fleets', 'ships', 'leases', 'credentials', 'messages', 'deliveries', 'events', 'console_sessions'];

let core: PostgresCore;
let fleetId: FleetId;
let argoId: ShipId;
let argo: Caller;

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await core.useCases.initialiseFleet({ name: 'home fleet' }));
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

async function shipsNamed(name: string) {
  return core.prisma.ship.findMany({ where: { fleetId, name }, orderBy: { id: 'asc' } });
}

/** Every row of every table as JSON text, to search for what must never be stored. */
async function everyRow(): Promise<string> {
  const tables = await Promise.all(
    // The table names are the constant list above, never outside input.
    TABLES.map((table) => core.prisma.$queryRawUnsafe<unknown[]>(`SELECT row_to_json(t) AS row FROM ${table} t`)),
  );
  return JSON.stringify(tables);
}

describe('commissioning a ship on Postgres', () => {
  it('stores an agent ship awaiting crew and the hash of its first secret', async () => {
    const { shipId, prompt } = unwrap(
      await core.useCases.commissionShip(argo, { name: 'scout', type: 'reviewer', note: 'reviews pull requests' }),
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
    });
    await expect(core.prisma.credential.findMany({ where: { shipId } })).resolves.toEqual([
      expect.objectContaining({
        secretHash: sha256Hasher.hash(secretIn(prompt)),
        issuedAt: core.clock.now(),
        claimedAt: null,
        invalidatedAt: null,
      }),
    ]);
    await expect(core.prisma.lease.count({ where: { shipId } })).resolves.toBe(0);
  });

  it('writes ShipCommissioned and StartingPromptIssued in the same transaction, caused by argo', async () => {
    const { shipId } = unwrap(await core.useCases.commissionShip(argo, { name: 'scout', type: 'reviewer' }));
    const credential = await core.prisma.credential.findFirst({ where: { shipId } });

    await expect(eventsAbout(shipId)).resolves.toEqual([
      ['ShipCommissioned', argoId, { name: 'scout', type: 'reviewer', kind: 'agent' }],
      ['StartingPromptIssued', argoId, { credentialId: credential?.id }],
    ]);
  });

  it('keeps the secret out of every table', async () => {
    const { prompt } = unwrap(await core.useCases.commissionShip(argo, { name: 'scout', type: 'reviewer' }));

    const rows = await everyRow();

    expect(rows).toContain(sha256Hasher.hash(secretIn(prompt)));
    expect(rows).not.toContain(secretIn(prompt));
  });

  it('refuses a name an active ship holds', async () => {
    unwrap(await core.useCases.commissionShip(argo, { name: 'scout', type: 'reviewer' }));

    await expect(core.useCases.commissionShip(argo, { name: 'scout', type: 'lookout' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NAME_TAKEN' },
    });
    await expect(shipsNamed('scout')).resolves.toHaveLength(1);
  });

  it("reuses a retired ship's name", async () => {
    const first = unwrap(await core.useCases.commissionShip(argo, { name: 'scout', type: 'reviewer' }));
    // Retiring arrives with a later slice.
    await core.prisma.ship.update({ where: { id: first.shipId }, data: { retiredAt: core.clock.now() } });

    const second = unwrap(await core.useCases.commissionShip(argo, { name: 'scout', type: 'reviewer' }));

    await expect(shipsNamed('scout')).resolves.toEqual([
      expect.objectContaining({ id: first.shipId, retiredAt: core.clock.now() }),
      expect.objectContaining({ id: second.shipId, retiredAt: null }),
    ]);
  });

  it('refuses argo as a name', async () => {
    await expect(core.useCases.commissionShip(argo, { name: 'argo', type: 'reviewer' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NAME_RESERVED' },
    });
  });

  it('serialises concurrent commissions of one name: one ship, every other one refused', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => core.useCases.commissionShip(argo, { name: 'scout', type: 'reviewer' })),
    );

    expect(results.filter((result) => result.isOk)).toHaveLength(1);
    expect(results.filter((result) => !result.isOk)).toEqual(
      Array.from({ length: 4 }, () => expect.objectContaining({ error: expect.objectContaining({ kind: 'SHIP_NAME_TAKEN' }) })),
    );
    const [scout] = await shipsNamed('scout');
    await expect(core.prisma.credential.count({ where: { shipId: scout?.id } })).resolves.toBe(1);
  });

  it('commissions different names concurrently', async () => {
    const names = ['scout', 'lookout', 'pilot'];

    const results = await Promise.all(
      names.map((name) => core.useCases.commissionShip(argo, { name, type: 'reviewer' })),
    );

    expect(results.map((result) => result.isOk)).toEqual([true, true, true]);
  });

  it('leaves no ship, secret or event behind when a write fails halfway', async () => {
    const before = await everyRow();
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
      secrets: { hasher: sha256Hasher, random: { next: () => 'random' } },
      fleetUrl: FLEET_URL,
    });

    await expect(commissionShip(argo, { name: 'scout', type: 'reviewer' })).rejects.toThrow('disk full');

    await expect(everyRow()).resolves.toBe(before);
  });
});
