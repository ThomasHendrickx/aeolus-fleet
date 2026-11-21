/** #1991: inheritance, concurrent owner writers and complete retirement rollback on Postgres. */
import { createIdGenerator, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { cryptoRandomTokens, sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createCommissionShip } from '../src/domain/registry/commission-ship.js';
import { createRetireShip } from '../src/domain/registry/retire-ship.js';
import { createSetOwner } from '../src/domain/registry/set-owner.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases } from '../src/wiring.js';
import { agentCaller, operatorCaller, secretOf, SESSION_MODEL } from './support/core-fixtures.js';
import { aQuestion } from './support/formatted-message-fixtures.js';
import { createPostgresCore, everyRow, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { withOperatorLogin } from './support/operator-login.js';
import { unsealedFleetsOnly } from './support/sealing.js';

let core: PostgresCore;
let argo: ShipCaller;
let parent: ShipId;
let owner: ShipId;
let child: ShipId;
const ids = createIdGenerator();

async function aShip(name: string, kind: 'agent' | 'app' | 'person' = 'agent') {
  return unwrap(await core.useCases.commissionShip(argo, { name, kind, type: kind, idempotencyKey: newKey() }));
}

async function ownerOf(shipId: ShipId) {
  return (await core.prisma.ship.findUniqueOrThrow({ where: { id: shipId } })).ownerShipId;
}

async function transfersOf(shipId: ShipId) {
  const events = await core.prisma.event.findMany({ where: { fleetId: argo.fleetId, shipId, type: 'OwnerChanged' }, orderBy: { seq: 'asc' } });
  return events.map(({ details }) => details);
}

function retirement(uow: ReturnType<typeof heldUnitOfWork>['uow']) {
  return createRetireShip({ uow, clock: core.clock, ids, hasher: sha256Hasher, sealing: unsealedFleetsOnly });
}

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home' }))));
  parent = (await aShip('parent', 'app')).shipId;
  owner = (await aShip('owner')).shipId;
  child = (await aShip('child')).shipId;
  unwrap(await core.useCases.setOwner(argo, { shipId: owner, ownerShipId: parent }));
  unwrap(await core.useCases.setOwner(argo, { shipId: child, ownerShipId: owner }));
});

afterEach(async () => { await core.close(); });

it.each(['agent', 'app'] as const)('durably transfers an %s owner\'s direct children, preserves grandchildren and stored question destinations', async (kind) => {
  // Given an agent/app owner with a child, grandchild and a stored question from the child.
  const middle = kind === 'agent' ? owner : (await aShip('middle', kind)).shipId;
  if (middle !== owner) {
    unwrap(await core.useCases.setOwner(argo, { shipId: middle, ownerShipId: parent }));
    unwrap(await core.useCases.setOwner(argo, { shipId: child, ownerShipId: middle }));
  }
  const grandchild = (await aShip('grandchild')).shipId;
  unwrap(await core.useCases.setOwner(argo, { shipId: grandchild, ownerShipId: child }));
  const { messageId } = unwrap(await core.useCases.sendFormattedMessage(agentCaller({ fleetId: argo.fleetId, shipId: child }), {
    selector: { kind: 'ship', shipId: middle }, message: { kind: 'question', question: aQuestion() }, model: SESSION_MODEL, idempotencyKey: newKey(),
  }));
  const question = await core.prisma.message.findUniqueOrThrow({ where: { id: messageId } });

  // When the owner retires and a new composition reads the persisted state.
  unwrap(await core.useCases.retireShip(argo, { shipId: middle }));
  const restarted = createUseCases({ prisma: core.prisma, clock: core.clock });

  // Then only the direct child transfers and the question still names its original destination.
  await expect(restarted.getShip(argo, { shipId: child })).resolves.toMatchObject({ value: { owner: { id: parent } } });
  await expect(ownerOf(grandchild)).resolves.toBe(child);
  expect(await transfersOf(child)).toContainEqual({ fromShipId: middle, toShipId: parent, why: 'ownerRetired' });
  await expect(core.prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toEqual(question);
  await expect(core.prisma.delivery.findMany({ where: { messageId } })).resolves.toMatchObject([{ recipientShipId: middle, state: 'abandoned' }]);
});

it.each(['owner', 'parent'] as const)('serializes adjacent ancestor retirements with %s retiring first', async (first) => {
  // Given parent -> owner -> child and the first retirement holds ownership.
  const firstId = first === 'owner' ? owner : parent;
  const secondId = first === 'owner' ? parent : owner;
  const held = heldUnitOfWork(core.prisma, (tx, hold) => ({ ...tx, ships: { ...tx.ships, lockOwnership: async (fleetId) => {
    await tx.ships.lockOwnership(fleetId);
    await hold();
  } } }));

  // When adjacent owners retire concurrently in the specified order.
  const retiring = retirement(held.uow)(argo, { shipId: firstId });
  await held.reached;
  const results = await Promise.all([retiring, core.useCases.retireShip(argo, { shipId: secondId })]);

  // Then the child ends at argo, with precisely the transfers from that order.
  expect(results).toMatchObject([{ isOk: true }, { isOk: true }]);
  await expect(ownerOf(child)).resolves.toBe(argo.shipId);
  expect((await transfersOf(child)).filter((details) => typeof details === 'object' && details !== null && 'why' in details && details.why === 'ownerRetired')).toEqual(
    first === 'owner'
      ? [{ fromShipId: owner, toShipId: parent, why: 'ownerRetired' }, { fromShipId: parent, toShipId: argo.shipId, why: 'ownerRetired' }]
      : [{ fromShipId: owner, toShipId: argo.shipId, why: 'ownerRetired' }],
  );
  await expect(ownerOf(owner)).resolves.toBe(first === 'owner' ? parent : argo.shipId);
});

it('transfers a child commissioned before its selected owner retires concurrently', async () => {
  // Given a requester commission holding the ownership lock after reading its requester.
  const held = heldUnitOfWork(core.prisma, (tx, hold) => ({ ...tx, ships: { ...tx.ships, find: async (fleetId, shipId) => {
    const found = await tx.ships.find(fleetId, shipId);
    if (shipId === owner) await hold();
    return found;
  } } }));
  const commission = createCommissionShip({ uow: held.uow, clock: core.clock, ids, secrets: { hasher: sha256Hasher, random: cryptoRandomTokens } });

  // When retirement races behind the new requester-owned child.
  const commissioning = commission(argo, { name: 'new-child', type: 'worker', ownerOf: owner, ownership: 'requester', idempotencyKey: newKey() });
  await held.reached;
  const [commissioned, retired] = await Promise.all([commissioning, core.useCases.retireShip(argo, { shipId: owner })]);

  // Then retirement includes the committed child in the same parent transfer.
  unwrap(retired);
  const { shipId } = unwrap(commissioned);
  await expect(ownerOf(shipId)).resolves.toBe(parent);
  await expect(transfersOf(shipId)).resolves.toEqual([{ fromShipId: owner, toShipId: parent, why: 'ownerRetired' }]);
});

it('transfers a child assigned before its selected owner retires concurrently', async () => {
  // Given setOwner holds ownership before assigning another active child.
  const another = (await aShip('another')).shipId;
  const held = heldUnitOfWork(core.prisma, (tx, hold) => ({ ...tx, ships: { ...tx.ships, lockOwnership: async (fleetId) => {
    await tx.ships.lockOwnership(fleetId);
    await hold();
  } } }));
  const setOwner = createSetOwner({ uow: held.uow, clock: core.clock, ids });

  // When retirement races behind the owner assignment.
  const assigning = setOwner(argo, { shipId: another, ownerShipId: owner });
  await held.reached;
  const results = await Promise.all([assigning, core.useCases.retireShip(argo, { shipId: owner })]);

  // Then the newly assigned child inherits the immediate parent too.
  expect(results).toMatchObject([{ isOk: true }, { isOk: true }]);
  await expect(ownerOf(another)).resolves.toBe(parent);
  await expect(transfersOf(another)).resolves.toEqual([
    { fromShipId: argo.shipId, toShipId: owner, why: 'set' },
    { fromShipId: owner, toShipId: parent, why: 'ownerRetired' },
  ]);
});

it.each(['commission', 'setOwner'] as const)('refuses a concurrent %s selecting an owner whose retirement commits first', async (writer) => {
  // Given retirement holds ownership before a concurrent writer can select that owner.
  const another = (await aShip('another')).shipId;
  const held = heldUnitOfWork(core.prisma, (tx, hold) => ({ ...tx, ships: { ...tx.ships, lockOwnership: async (fleetId) => {
    await tx.ships.lockOwnership(fleetId);
    await hold();
  } } }));

  // When a commission or setOwner attempts to select the retiring owner.
  const retiring = retirement(held.uow)(argo, { shipId: owner });
  await held.reached;
  const writing = writer === 'commission'
    ? core.useCases.commissionShip(argo, { name: 'new-child', type: 'worker', ownerOf: owner, ownership: 'requester', idempotencyKey: 'new-child' })
    : core.useCases.setOwner(argo, { shipId: another, ownerShipId: owner });
  unwrap(await retiring);

  // Then no child points to the retired owner and the refused writer stores no assignment.
  await expect(writing).resolves.toMatchObject({ isOk: false, error: { kind: writer === 'commission' ? 'SHIP_ALREADY_RETIRED' : 'INVALID_OWNER' } });
  await expect(ownerOf(child)).resolves.toBe(parent);
  await expect(ownerOf(another)).resolves.toBe(argo.shipId);
  await expect(transfersOf(another)).resolves.toEqual([]);
  await expect(core.prisma.ship.count({ where: { fleetId: argo.fleetId, name: 'new-child' } })).resolves.toBe(0);
});

it.each(['second transfer event', 'late cleanup'] as const)('rolls back owners, retirement, lease end, cleanup and events after failure at %s', async (failure) => {
  // Given a crewed owner with two children, a pending delivery, crew request, label and schedule.
  const second = (await aShip('second')).shipId;
  unwrap(await core.useCases.setOwner(argo, { shipId: second, ownerShipId: owner }));
  const prompt = unwrap(await core.useCases.getStartingPrompt(argo, { shipId: owner }));
  unwrap(await core.useCases.claimShip({ shipId: owner, secret: secretOf(prompt.secret), harness: 'codex', location: { kind: 'DEVICE' } }));
  unwrap(await core.useCases.requestCrew(argo, { shipId: owner, settings: {} }));
  const ownerCaller: ShipCaller = { ...agentCaller({ fleetId: argo.fleetId, shipId: owner }), scopes: ['messages:send', 'messages:receive', 'labels:define'] };
  unwrap(await core.useCases.defineLabel(ownerCaller, { key: 'owned', values: ['child'] }));
  unwrap(await core.useCases.sendMessage(argo, { selector: { kind: 'ship', shipId: owner }, payload: 'pending', idempotencyKey: newKey() }));
  unwrap(await core.useCases.sendFormattedMessage(ownerCaller, { selector: { kind: 'ship', shipId: parent }, message: { kind: 'question', question: aQuestion() }, model: SESSION_MODEL, idempotencyKey: newKey() }));
  unwrap(await core.useCases.scheduleMessage(ownerCaller, { selector: { kind: 'ship', shipId: parent }, payload: 'later', model: SESSION_MODEL, timing: { kind: 'once', at: new Date('2027-01-01T00:00:00.000Z') }, idempotencyKey: newKey() }));
  const snapshot = async () => ({ rows: await everyRow(core.prisma), requests: await core.prisma.crewRequest.findMany(), labels: await core.prisma.label.findMany(), schedules: await core.prisma.schedule.findMany() });
  const before = await snapshot();
  const held = heldUnitOfWork(core.prisma, (tx) => ({
    ...tx,
    events: { ...tx.events, append: (event) => failure === 'second transfer event' && event.type === 'OwnerChanged' && event.shipId === second
      ? Promise.reject(new Error('injected failure')) : tx.events.append(event) },
    expectations: { ...tx.expectations, remove: (fleetId, shipId) => failure === 'late cleanup'
      ? Promise.reject(new Error('injected failure')) : tx.expectations.remove(fleetId, shipId) },
  }));

  // When persistence fails after transfers began or after the rest of retirement cleanup.
  await expect(retirement(held.uow)(argo, { shipId: owner })).rejects.toThrow('injected failure');

  // Then every persisted fact is restored and retry transfers both children exactly once.
  await expect(snapshot()).resolves.toEqual(before);
  unwrap(await core.useCases.retireShip(argo, { shipId: owner }));
  await expect(ownerOf(child)).resolves.toBe(parent);
  await expect(ownerOf(second)).resolves.toBe(parent);
  expect(await transfersOf(second)).toEqual([
    { fromShipId: argo.shipId, toShipId: owner, why: 'set' },
    { fromShipId: owner, toShipId: parent, why: 'ownerRetired' },
  ]);
});
