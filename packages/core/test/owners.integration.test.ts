import { SCOPES, accountIdSchema, createIdGenerator, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cryptoRandomTokens, sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createCommissionShip } from '../src/domain/registry/commission-ship.js';
import { createRetireShip } from '../src/domain/registry/retire-ship.js';
import { createSetOwner } from '../src/domain/registry/set-owner.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { operatorCaller } from './support/core-fixtures.js';
import { createPostgresCore, everyRow, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { newKey } from '../src/testing/keys.js';
import { withOperatorLogin } from './support/operator-login.js';
import { unsealedFleetsOnly } from './support/sealing.js';

// Owners on a real Postgres (decision 0045): every ship but argo and the
// viewer has one, set and changed with its event in the same transaction.

const newId = createIdGenerator();

let core: PostgresCore;
let fleetId: FleetId;
let argoId: ShipId;
let argo: ShipCaller;

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' })));
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
      ['OwnerChanged', { fromShipId: argoId, toShipId: thomasId, why: 'set' }],
    ]);
  });

  it('serializes opposite owner edges so only one commits', async () => {
    // Given two active agents rooted at argo.
    const { shipId: peerId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'peer', type: 'worker' }));

    // When opposite assignments run concurrently.
    const results = await Promise.all([
      core.useCases.setOwner(argo, { shipId: scoutId, ownerShipId: peerId }),
      core.useCases.setOwner(argo, { shipId: peerId, ownerShipId: scoutId }),
    ]);

    // Then one edge and exactly one event commit, and the other refuses a cycle.
    expect(results.filter((result) => result.isOk)).toHaveLength(1);
    expect(results.find((result) => !result.isOk)).toMatchObject({ error: { kind: 'OWNERSHIP_CYCLE' } });
    expect(await core.prisma.event.count({ where: { fleetId, type: 'OwnerChanged' } })).toBe(1);
    expect([await ownerOf(scoutId), await ownerOf(peerId)]).toContain(argoId);
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
      ['OwnerChanged', { fromShipId: argoId, toShipId: thomasId, why: 'set' }],
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
      hasher: sha256Hasher,
      sealing: unsealedFleetsOnly,
    });

    await expect(failingRetire(argo, { shipId: thomasId })).rejects.toThrow('disk full');

    await expect(everyRow(core.prisma)).resolves.toBe(before);
  });
});

describe('a commission racing the retire of the owner it inherits on Postgres', () => {
  let thomasId: ShipId;
  let scoutId: ShipId;
  let scout: ShipCaller;

  beforeEach(async () => {
    ({ shipId: thomasId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' })));
    ({ shipId: scoutId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer', scopes: ['fleet:commission', 'fleet:on-behalf'] })));
    scout = { shipId: scoutId, fleetId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:commission', 'fleet:on-behalf'] };
  });

  it.each(['commissioner', 'requester'] as const)('serializes retirement behind the %s owner read and transfers the new child', async (mode) => {
    // Given a commission held after reading a ship whose owner is thomas.
    unwrap(await core.useCases.setOwner(argo, { shipId: scoutId, ownerShipId: thomasId }));
    const held = heldUnitOfWork(core.prisma, (tx, hold) => ({ ...tx, ships: { ...tx.ships, find: async (id, shipId) => {
      const ship = await tx.ships.find(id, shipId);
      if (shipId === scoutId) await hold();
      return ship;
    } } }));
    const commission = createCommissionShip({ uow: held.uow, clock: core.clock, ids: newId, secrets: { hasher: sha256Hasher, random: cryptoRandomTokens } });

    // When retirement races the commission, it must wait for ownership.
    const pending = commission(scout, { idempotencyKey: newKey(), name: 'helper', type: 'reviewer', ...(mode === 'requester' ? { ownerOf: scoutId } : {}) });
    await held.reached;
    const retirement = core.useCases.retireShip(argo, { shipId: thomasId });
    const [commissioned, retired] = await Promise.all([pending, retirement]);

    // Then retirement finds the committed child and transfers it with its event.
    const { shipId } = unwrap(commissioned);
    unwrap(retired);
    await expect(ownerOf(shipId)).resolves.toBe(argoId);
    expect(await ownerEventsAbout(shipId)).toContainEqual(['OwnerChanged', { fromShipId: thomasId, toShipId: argoId, why: 'ownerRetired' }]);
  });

});

describe('the owner argo picked for an app ship the gateway commissions, on Postgres', () => {
  let thomasId: ShipId;
  let gateway: ShipCaller;

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

  it('serializes a named owner commission before its retirement', async () => {
    // Given a commission held after reading the gateway.
    const held = heldUnitOfWork(core.prisma, (tx, hold) => ({ ...tx, ships: { ...tx.ships, find: async (id, shipId) => {
      const ship = await tx.ships.find(id, shipId);
      if (shipId === gateway.shipId) await hold();
      return ship;
    } } }));
    const commission = createCommissionShip({ uow: held.uow, clock: core.clock, ids: newId, secrets: { hasher: sha256Hasher, random: cryptoRandomTokens } });

    // When the named owner retires concurrently.
    const pending = commission(gateway, { idempotencyKey: newKey(), name: 'crm', type: 'crm', kind: 'app', owner: thomasId });
    await held.reached;
    const [commissioned, retired] = await Promise.all([pending, core.useCases.retireShip(argo, { shipId: thomasId })]);

    // Then both commit in order and the child never keeps a retired owner.
    unwrap(retired);
    await expect(ownerOf(unwrap(commissioned).shipId)).resolves.toBe(argoId);
  });

});

describe('the owner read on Postgres', () => {
  it("shows the owner by id and name in whoami and the ship read, a person ship its own, none for argo", async () => {
    const { shipId: scoutId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const { shipId: thomasId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));
    unwrap(await core.useCases.setOwner(argo, { shipId: scoutId, ownerShipId: thomasId }));
    const scout: ShipCaller = { shipId: scoutId, fleetId, kind: 'agent', scopes: ['messages:send', 'messages:receive'] };

    await expect(core.useCases.whoami(scout)).resolves.toMatchObject({ isOk: true, value: { ownerShipId: thomasId, ownerName: 'thomas' } });
    await expect(core.useCases.getShip(argo, { shipId: scoutId })).resolves.toMatchObject({ isOk: true, value: { owner: { id: thomasId, name: 'thomas' } } });
    await expect(core.useCases.getShip(argo, { shipId: thomasId })).resolves.toMatchObject({ isOk: true, value: { owner: { id: thomasId, name: 'thomas' } } });
    await expect(core.useCases.whoami(argo)).resolves.toMatchObject({ isOk: true, value: { ownerShipId: null, ownerName: null } });
  });
});

describe('a ship argo commissions from the console, on Postgres (#1777)', () => {
  let charlotteId: ShipId;
  let burakId: ShipId;
  let argoInConsole: ShipCaller;

  beforeEach(async () => {
    ({ shipId: charlotteId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'charlotte', type: 'person', kind: 'person', scopes: ['fleet:commission'] })));
    ({ shipId: burakId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'burak', type: 'person', kind: 'person' })));
    argoInConsole = { ...argo, consoleSessionId: newId('consoleSession') };
  });

  it('stores the person ship argo names as its owner, with OwnerSet saying it was named', async () => {
    const { shipId } = unwrap(await core.useCases.commissionShip(argoInConsole, { idempotencyKey: newKey(), name: 'reviewer-03', type: 'reviewer', owner: charlotteId }));

    await expect(ownerOf(shipId)).resolves.toBe(charlotteId);
    await expect(ownerEventsAbout(shipId)).resolves.toEqual([['OwnerSet', { ownerShipId: charlotteId, how: 'named' }]]);
  });

  it('answers the owner argo named at its last commission, and none before it named one', async () => {
    await expect(core.useCases.readLastNamedOwner(argoInConsole)).resolves.toBeNull();
    unwrap(await core.useCases.commissionShip(argoInConsole, { idempotencyKey: newKey(), name: 'reviewer-01', type: 'reviewer', owner: charlotteId }));
    unwrap(await core.useCases.commissionShip(argoInConsole, { idempotencyKey: newKey(), name: 'reviewer-02', type: 'reviewer', owner: burakId }));

    const owner = await core.useCases.readLastNamedOwner(argoInConsole);

    expect(owner).toEqual({ id: burakId, name: 'burak' });
  });

  it('names the owner in whoami and the ship read, for argo, an account, a person-owned orchestrator and an argo-owned one as commissioner', async () => {
    const { shipId: named } = unwrap(await core.useCases.commissionShip(argoInConsole, { idempotencyKey: newKey(), name: 'reviewer-03', type: 'reviewer', owner: charlotteId }));
    const account = { kind: 'account' as const, accountId: accountIdSchema.parse('acc_1777'), fleetId, scopes: [...SCOPES], groupValues: [], personShipId: burakId, throughShipId: null };
    const { shipId: accounts } = unwrap(await core.useCases.commissionShip(account, { idempotencyKey: newKey(), name: 'helper', type: 'helper' }));
    const { shipId: personOrchestratorId } = unwrap(await core.useCases.commissionShip(argoInConsole, { idempotencyKey: newKey(), name: 'orchestrator-1', type: 'orchestrator', owner: charlotteId, scopes: ['fleet:commission'] }));
    const personOrchestrator: ShipCaller = { shipId: personOrchestratorId, fleetId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:commission'] };
    const { shipId: fromPersonOrchestrator } = unwrap(await core.useCases.commissionShip(personOrchestrator, { idempotencyKey: newKey(), name: 'build-1', type: 'implementer' }));
    const { shipId: argoOrchestratorId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'orchestrator-2', type: 'orchestrator', scopes: ['fleet:commission'] }));
    const argoOrchestrator: ShipCaller = { shipId: argoOrchestratorId, fleetId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:commission'] };
    const { shipId: fromArgoOrchestrator } = unwrap(await core.useCases.commissionShip(argoOrchestrator, { idempotencyKey: newKey(), name: 'build-2', type: 'implementer' }));

    const owners = await Promise.all(
      [named, accounts, fromPersonOrchestrator, fromArgoOrchestrator].map(async (shipId) => {
        const whoami = unwrap(await core.useCases.whoami({ shipId, fleetId, kind: 'agent', scopes: ['messages:send', 'messages:receive'] }));
        const ship = unwrap(await core.useCases.getShip(argo, { shipId }));
        return { whoami: whoami.ownerName, ship: 'owner' in ship ? ship.owner?.name : undefined };
      }),
    );

    expect(owners).toEqual([
      { whoami: 'charlotte', ship: 'charlotte' },
      { whoami: 'burak', ship: 'burak' },
      { whoami: 'charlotte', ship: 'charlotte' },
      { whoami: 'argo', ship: 'argo' },
    ]);
    await expect(ownerEventsAbout(accounts)).resolves.toEqual([['OwnerSet', { ownerShipId: burakId, how: 'accountPersonShip' }]]);
    await expect(ownerEventsAbout(fromPersonOrchestrator)).resolves.toEqual([['OwnerSet', { ownerShipId: charlotteId, how: 'inherited' }]]);
    await expect(ownerEventsAbout(fromArgoOrchestrator)).resolves.toEqual([['OwnerSet', { ownerShipId: argoId, how: 'inherited' }]]);
  });
});
