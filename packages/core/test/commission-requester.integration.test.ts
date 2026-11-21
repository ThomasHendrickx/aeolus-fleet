/** #1990: requester ownership is durable and serialized with retirement. */
import { createIdGenerator } from '@aeolus-fleet/common';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { cryptoRandomTokens, sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createCommissionShip } from '../src/domain/registry/commission-ship.js';
import { createRetireShip } from '../src/domain/registry/retire-ship.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases } from '../src/wiring.js';
import { operatorCaller } from './support/core-fixtures.js';
import { createPostgresCore, everyRow, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { withOperatorLogin } from './support/operator-login.js';
import { unsealedFleetsOnly } from './support/sealing.js';

let core: PostgresCore;
let argo: ShipCaller;
let requester: ShipCaller;
const request = { name: 'helper', type: 'reviewer', idempotencyKey: 'helper', ownership: 'requester' as const };

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home' }))));
  const { shipId } = unwrap(await core.useCases.commissionShip(argo, { name: 'requester', type: 'agent', scopes: ['fleet:commission', 'fleet:on-behalf'], idempotencyKey: 'requester' }));
  requester = { fleetId: argo.fleetId, shipId, kind: 'agent', scopes: ['fleet:commission', 'fleet:on-behalf'] };
});
afterEach(async () => { await core.close(); });

it('requester owner and evidence survive restart; concurrent retries return one ship and one secret', async () => {
  // Given two commissions with the same effective ownership and key.
  const input = { ...request, ownerOf: requester.shipId };

  // When they race and a restarted core replays the request.
  const answers = await Promise.all([core.useCases.commissionShip(requester, input), core.useCases.commissionShip(requester, input)]);
  const first = unwrap(answers[0]);
  const second = unwrap(answers[1]);
  const restarted = createUseCases({ prisma: core.prisma, clock: core.clock });
  const replay = unwrap(await restarted.commissionShip(requester, input));

  // Then the one assignment is durable and only one answer ever holds the secret.
  expect(second.shipId).toBe(first.shipId);
  expect([first, second].filter((answer) => answer.secret !== null)).toHaveLength(1);
  expect(replay).toMatchObject({ shipId: first.shipId, secret: null, startingPrompt: { isClaimed: false } });
  await expect(core.prisma.ship.findUniqueOrThrow({ where: { id: first.shipId } })).resolves.toMatchObject({ ownerShipId: requester.shipId });
  await expect(core.prisma.event.findMany({ where: { shipId: first.shipId, type: 'OwnerSet' } })).resolves.toMatchObject([{ details: { ownerShipId: requester.shipId, askingShipId: requester.shipId, how: 'askingShip' } }]);
  await expect(core.prisma.ship.count({ where: { fleetId: argo.fleetId, name: 'helper' } })).resolves.toBe(1);
});

it('commission before concurrent requester retirement commits askingShip evidence and retirement transfers the child', async () => {
  // Given a commission holding the fleet ownership lock after reading the requester.
  const held = heldUnitOfWork(core.prisma, (tx, hold) => ({ ...tx, ships: { ...tx.ships, find: async (fleetId, shipId) => {
    const ship = await tx.ships.find(fleetId, shipId);
    if (shipId === requester.shipId) await hold();
    return ship;
  } } }));
  const commission = createCommissionShip({ uow: held.uow, clock: core.clock, ids: createIdGenerator(), secrets: { hasher: sha256Hasher, random: cryptoRandomTokens } });

  // When its selected owner retires concurrently.
  const commissioning = commission(argo, { ...request, ownerOf: requester.shipId });
  await held.reached;
  const [commissioned, retired] = await Promise.all([commissioning, core.useCases.retireShip(argo, { shipId: requester.shipId })]);

  // Then the child is transferred within retirement and never keeps a retired owner.
  const { shipId } = unwrap(commissioned);
  unwrap(retired);
  await expect(core.prisma.ship.findUniqueOrThrow({ where: { id: shipId } })).resolves.toMatchObject({ ownerShipId: argo.shipId });
  await expect(core.prisma.event.findMany({ where: { shipId, type: { in: ['OwnerSet', 'OwnerChanged'] } }, orderBy: { id: 'asc' } })).resolves.toMatchObject([
    { type: 'OwnerSet', details: { ownerShipId: requester.shipId, askingShipId: requester.shipId, how: 'askingShip' } },
    { type: 'OwnerChanged', details: { fromShipId: requester.shipId, toShipId: argo.shipId, why: 'ownerRetired' } },
  ]);
});

it('requester retirement before a concurrent commission refuses without consuming its key', async () => {
  // Given retirement holds ownership before it changes the selected owner.
  const held = heldUnitOfWork(core.prisma, (tx, hold) => ({ ...tx, ships: { ...tx.ships, lockOwnership: async (fleetId) => { await tx.ships.lockOwnership(fleetId); await hold(); } } }));
  const retire = createRetireShip({ uow: held.uow, clock: core.clock, ids: createIdGenerator(), hasher: sha256Hasher, sealing: unsealedFleetsOnly });

  // When a commission races behind it.
  const retiring = retire(argo, { shipId: requester.shipId });
  await held.reached;
  const commissioning = core.useCases.commissionShip(argo, { ...request, ownerOf: requester.shipId });
  unwrap(await retiring);

  // Then the retired requester grants nothing and the key remains available.
  await expect(commissioning).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_ALREADY_RETIRED' } });
  await expect(core.prisma.ship.count({ where: { fleetId: argo.fleetId, name: 'helper' } })).resolves.toBe(0);
  expect(unwrap(await core.useCases.commissionShip(argo, { ...request, ownerOf: argo.shipId })).secret).toEqual(expect.any(String));
});

it('a failed askingShip OwnerSet rolls back ship, credentials, events and key', async () => {
  // Given the assignment event cannot be persisted.
  const before = await everyRow(core.prisma);
  const held = heldUnitOfWork(core.prisma, (tx) => ({ ...tx, events: { ...tx.events, append: (event) => event.type === 'OwnerSet' ? Promise.reject(new Error('event failed')) : tx.events.append(event) } }));
  const commission = createCommissionShip({ uow: held.uow, clock: core.clock, ids: createIdGenerator(), secrets: { hasher: sha256Hasher, random: cryptoRandomTokens } });
  const input = { ...request, ownerOf: requester.shipId };

  // When the commission fails mid-transaction.
  await expect(commission(argo, input)).rejects.toThrow('event failed');

  // Then nothing was stored and retry can complete the original assignment.
  await expect(everyRow(core.prisma)).resolves.toBe(before);
  const { shipId } = unwrap(await core.useCases.commissionShip(argo, input));
  await expect(core.prisma.ship.findUniqueOrThrow({ where: { id: shipId } })).resolves.toMatchObject({ ownerShipId: requester.shipId });
});
