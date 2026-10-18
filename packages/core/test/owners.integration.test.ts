import { createIdGenerator, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cryptoRandomTokens, sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createCommissionShip } from '../src/domain/registry/commission-ship.js';
import { createRetireShip } from '../src/domain/registry/retire-ship.js';
import { createSetOwner } from '../src/domain/registry/set-owner.js';
import type { Caller } from '../src/domain/shared/caller.js';
import { OPERATOR, operatorCaller } from './support/core-fixtures.js';
import { createPostgresCore, everyRow, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// Owners on a real Postgres (decision 0045): every ship but argo and the
// viewer has one, set and changed with its event in the same transaction.

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

/** The OwnerSet and OwnerChanged events about the ship, oldest first, as type and details. */
async function ownerEventsAbout(shipId: ShipId) {
  const events = await core.prisma.event.findMany({ where: { fleetId, shipId, type: { in: ['OwnerSet', 'OwnerChanged'] } }, orderBy: { id: 'asc' } });
  return events.map((event) => [event.type, event.details]);
}

async function ownerOf(shipId: ShipId) {
  return (await core.prisma.ship.findUniqueOrThrow({ where: { id: shipId } })).ownerShipId;
}

describe('the owner set at commission on Postgres', () => {
  it('stores argo as the owner of a ship argo commissions, with OwnerSet', async () => {
    const { shipId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    await expect(ownerOf(shipId)).resolves.toBe(argoId);
    await expect(ownerEventsAbout(shipId)).resolves.toEqual([['OwnerSet', { ownerShipId: argoId, how: 'argoByDefault' }]]);
  });

  it('stores nothing when its OwnerSet cannot be written', async () => {
    const before = await everyRow(core.prisma);
    const failingCommission = createCommissionShip({
      uow: {
        run: (work) =>
          createPrismaUnitOfWork(core.prisma).run((tx) =>
            work({
              ...tx,
              events: { append: (event) => (event.type === 'OwnerSet' ? Promise.reject(new Error('disk full')) : tx.events.append(event)) },
            }),
          ),
      },
      clock: core.clock,
      ids: newId,
      secrets: { hasher: sha256Hasher, random: cryptoRandomTokens },
    });

    await expect(failingCommission(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })).rejects.toThrow('disk full');

    await expect(everyRow(core.prisma)).resolves.toBe(before);
  });
});

describe('setting an owner on Postgres', () => {
  let scoutId: ShipId;
  let thomasId: ShipId;

  beforeEach(async () => {
    ({ shipId: scoutId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
    ({ shipId: thomasId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' })));
  });

  it('stores the new owner with OwnerChanged', async () => {
    unwrap(await core.useCases.setOwner(argo, { shipId: scoutId, ownerShipId: thomasId }));

    await expect(ownerOf(scoutId)).resolves.toBe(thomasId);
    await expect(ownerEventsAbout(scoutId)).resolves.toEqual([
      ['OwnerSet', { ownerShipId: argoId, how: 'argoByDefault' }],
      ['OwnerChanged', { fromShipId: argoId, toShipId: thomasId, why: 'setByArgo' }],
    ]);
  });

  it('stores nothing when its OwnerChanged cannot be written', async () => {
    const before = await everyRow(core.prisma);
    const failingSetOwner = createSetOwner({
      uow: {
        run: (work) => createPrismaUnitOfWork(core.prisma).run((tx) => work({ ...tx, events: { append: () => Promise.reject(new Error('disk full')) } })),
      },
      clock: core.clock,
      ids: newId,
    });

    await expect(failingSetOwner(argo, { shipId: scoutId, ownerShipId: thomasId })).rejects.toThrow('disk full');

    await expect(everyRow(core.prisma)).resolves.toBe(before);
  });
});

describe('a retired owner on Postgres', () => {
  let scoutId: ShipId;
  let thomasId: ShipId;

  beforeEach(async () => {
    ({ shipId: scoutId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
    ({ shipId: thomasId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' })));
    unwrap(await core.useCases.setOwner(argo, { shipId: scoutId, ownerShipId: thomasId }));
  });

  it("hands its ships to argo with OwnerChanged, in the retire's transaction", async () => {
    unwrap(await core.useCases.retireShip(argo, { shipId: thomasId }));

    await expect(ownerOf(scoutId)).resolves.toBe(argoId);
    await expect(ownerEventsAbout(scoutId)).resolves.toEqual([
      ['OwnerSet', { ownerShipId: argoId, how: 'argoByDefault' }],
      ['OwnerChanged', { fromShipId: argoId, toShipId: thomasId, why: 'setByArgo' }],
      ['OwnerChanged', { fromShipId: thomasId, toShipId: argoId, why: 'ownerRetired' }],
    ]);
  });

  it('stores nothing, the owner not retired, when an OwnerChanged cannot be written', async () => {
    const before = await everyRow(core.prisma);
    const failingRetire = createRetireShip({
      uow: {
        run: (work) =>
          createPrismaUnitOfWork(core.prisma).run((tx) =>
            work({
              ...tx,
              events: { append: (event) => (event.type === 'OwnerChanged' ? Promise.reject(new Error('disk full')) : tx.events.append(event)) },
            }),
          ),
      },
      clock: core.clock,
      ids: newId,
    });

    await expect(failingRetire(argo, { shipId: thomasId })).rejects.toThrow('disk full');

    await expect(everyRow(core.prisma)).resolves.toBe(before);
  });
});

describe('the owner read on Postgres', () => {
  it("shows the owner by id and name in whoami and the ship read, none for argo", async () => {
    const { shipId: scoutId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const { shipId: thomasId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));
    unwrap(await core.useCases.setOwner(argo, { shipId: scoutId, ownerShipId: thomasId }));
    const scout: Caller = { shipId: scoutId, fleetId, kind: 'agent', scopes: ['messages:send', 'messages:receive'] };

    await expect(core.useCases.whoami(scout)).resolves.toMatchObject({ isOk: true, value: { owner: { id: thomasId, name: 'thomas' } } });
    await expect(core.useCases.getShip(argo, { shipId: scoutId })).resolves.toMatchObject({ isOk: true, value: { owner: { id: thomasId, name: 'thomas' } } });
    await expect(core.useCases.getShip(argo, { shipId: thomasId })).resolves.toMatchObject({ isOk: true, value: { owner: { id: argoId, name: 'argo' } } });
    await expect(core.useCases.whoami(argo)).resolves.toMatchObject({ isOk: true, value: { owner: null } });
  });
});
