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
import { unwrap } from '../src/testing/result.js';
import { newKey } from '../src/testing/keys.js';

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

describe('a commission racing the retire of the owner it inherits on Postgres', () => {
  let thomasId: ShipId;
  let scoutId: ShipId;
  let scout: Caller;

  beforeEach(async () => {
    ({ shipId: thomasId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' })));
    ({ shipId: scoutId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer', scopes: ['fleet:commission', 'fleet:on-behalf'] })));
    scout = { shipId: scoutId, fleetId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:commission', 'fleet:on-behalf'] };
  });

  /** A commission that lets argo retire thomas, committed, right after it first reads the given ship. */
  function commissionRetiringThomasAfterReading(readShipId: ShipId) {
    let hasRetired = false;
    return createCommissionShip({
      uow: {
        run: (work) =>
          createPrismaUnitOfWork(core.prisma).run((tx) =>
            work({
              ...tx,
              ships: {
                ...tx.ships,
                find: async (shipFleetId, shipId) => {
                  const ship = await tx.ships.find(shipFleetId, shipId);
                  if (shipId === readShipId && !hasRetired) {
                    hasRetired = true;
                    unwrap(await core.useCases.retireShip(argo, { shipId: thomasId }));
                  }
                  return ship;
                },
              },
            }),
          ),
      },
      clock: core.clock,
      ids: newId,
      secrets: { hasher: sha256Hasher, random: cryptoRandomTokens },
    });
  }

  it("gives the new ship argo, never the retired owner, when the commissioner's owner retires mid-commission", async () => {
    unwrap(await core.useCases.setOwner(argo, { shipId: scoutId, ownerShipId: thomasId }));
    const commission = commissionRetiringThomasAfterReading(scoutId);

    const { shipId } = unwrap(await commission(scout, { idempotencyKey: newKey(), name: 'helper', type: 'reviewer' }));

    await expect(ownerOf(shipId)).resolves.toBe(argoId);
  });

  it("gives the new ship argo, never the retired owner, when the asking ship's owner retires mid-commission", async () => {
    const { shipId: askerId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'asker', type: 'reviewer' }));
    unwrap(await core.useCases.setOwner(argo, { shipId: askerId, ownerShipId: thomasId }));
    const commission = commissionRetiringThomasAfterReading(askerId);

    const { shipId } = unwrap(await commission(scout, { idempotencyKey: newKey(), name: 'helper', type: 'reviewer', ownerOf: askerId }));

    await expect(ownerOf(shipId)).resolves.toBe(argoId);
  });
});

describe('the owner argo picked for an app ship the gateway commissions, on Postgres', () => {
  let thomasId: ShipId;
  let gateway: Caller;

  beforeEach(async () => {
    ({ shipId: thomasId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' })));
    const { shipId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'gateway', type: 'gateway', scopes: ['fleet:commission', 'fleet:on-behalf'] }));
    gateway = { shipId, fleetId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:commission', 'fleet:on-behalf'] };
  });

  it('stores it as the app ship\'s owner, with OwnerSet saying it was named', async () => {
    const { shipId } = unwrap(await core.useCases.commissionShip(gateway, { idempotencyKey: newKey(), name: 'crm', type: 'crm', kind: 'app', owner: thomasId }));

    await expect(ownerOf(shipId)).resolves.toBe(thomasId);
    await expect(ownerEventsAbout(shipId)).resolves.toEqual([['OwnerSet', { ownerShipId: thomasId, how: 'named' }]]);
  });

  it('refuses it, storing no ship, when argo retired it just before the commission read it', async () => {
    let hasRetired = false;
    const commission = createCommissionShip({
      uow: {
        run: (work) =>
          createPrismaUnitOfWork(core.prisma).run((tx) =>
            work({
              ...tx,
              ships: {
                ...tx.ships,
                find: async (shipFleetId, shipId) => {
                  const ship = await tx.ships.find(shipFleetId, shipId);
                  if (shipId === gateway.shipId && !hasRetired) {
                    hasRetired = true;
                    unwrap(await core.useCases.retireShip(argo, { shipId: thomasId }));
                  }
                  return ship;
                },
              },
            }),
          ),
      },
      clock: core.clock,
      ids: newId,
      secrets: { hasher: sha256Hasher, random: cryptoRandomTokens },
    });

    const refused = await commission(gateway, { idempotencyKey: newKey(), name: 'crm', type: 'crm', kind: 'app', owner: thomasId });

    expect(refused).toMatchObject({ isOk: false, error: { kind: 'INVALID_OWNER' } });
    await expect(core.prisma.ship.count({ where: { fleetId, name: 'crm' } })).resolves.toBe(0);
  });
});

describe('the owner read on Postgres', () => {
  it("shows the owner by id and name in whoami and the ship read, none for argo", async () => {
    const { shipId: scoutId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const { shipId: thomasId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));
    unwrap(await core.useCases.setOwner(argo, { shipId: scoutId, ownerShipId: thomasId }));
    const scout: Caller = { shipId: scoutId, fleetId, kind: 'agent', scopes: ['messages:send', 'messages:receive'] };

    await expect(core.useCases.whoami(scout)).resolves.toMatchObject({ isOk: true, value: { ownerShipId: thomasId, ownerName: 'thomas' } });
    await expect(core.useCases.getShip(argo, { shipId: scoutId })).resolves.toMatchObject({ isOk: true, value: { owner: { id: thomasId, name: 'thomas' } } });
    await expect(core.useCases.getShip(argo, { shipId: thomasId })).resolves.toMatchObject({ isOk: true, value: { owner: { id: argoId, name: 'argo' } } });
    await expect(core.useCases.whoami(argo)).resolves.toMatchObject({ isOk: true, value: { ownerShipId: null, ownerName: null } });
  });
});
