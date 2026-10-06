import { createIdGenerator, idSchema, type DeliveryId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createSendMessage } from '../src/domain/messaging/send-message.js';
import { createRetireShip } from '../src/domain/registry/retire-ship.js';
import type { Caller, Crew } from '../src/domain/shared/caller.js';
import type { Selector } from '../src/domain/shared/selector.js';
import { OPERATOR, operatorCaller, secretOf } from './support/core-fixtures.js';
import { createPostgresCore, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// Retire and re-crew on a real Postgres: a crewed ship's lease ends first,
// its direct deliveries are abandoned and its type deliveries stay, a
// retired ship is never claimed or addressed again and its name is free; and
// a send racing a retire either lands first and is abandoned, or comes after
// and is refused.

const newId = createIdGenerator();

let core: PostgresCore;
let argo: Caller;
let scoutId: ShipId;
let scoutSecret: string;
let lookout: Crew;

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const scout = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  scoutId = scout.shipId;
  scoutSecret = secretOf(scout.secret);
  const lookoutShip = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' }));
  lookout = await crew(lookoutShip.shipId, secretOf(lookoutShip.secret));
});

afterEach(async () => {
  await core.close();
});

async function crew(shipId: ShipId, secret: string): Promise<Crew> {
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret, location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

async function sendTo(selector: Selector): Promise<{ messageId: MessageId; deliveryId: DeliveryId }> {
  const { messageId } = unwrap(
    await core.useCases.sendMessage(argo, { selector, payload: 'Review PR 48', idempotencyKey: `key-${newId('message')}` }),
  );
  const { id } = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
  return { messageId, deliveryId: idSchema('delivery').parse(id) };
}

function stored(deliveryId: DeliveryId) {
  return core.prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
}

describe('retiring a ship on Postgres', () => {
  it("ends a crewed ship's lease, abandons its direct deliveries, returns its type deliveries to the queue, and retires it", async () => {
    const scout = await crew(scoutId, scoutSecret);
    const toType = await sendTo({ kind: 'type', type: 'reviewer' });
    unwrap(await core.useCases.receiveDeliveries(scout, { max: 1 }));
    const direct = await sendTo({ kind: 'ship', shipId: scoutId });

    await expect(core.useCases.retireShip(argo, { shipId: scoutId })).resolves.toEqual({
      isOk: true,
      value: { abandonedDeliveries: 1 },
    });

    await expect(core.prisma.ship.findUniqueOrThrow({ where: { id: scoutId } })).resolves.not.toMatchObject({
      retiredAt: null,
    });
    await expect(core.prisma.lease.count({ where: { shipId: scoutId, endedAt: null } })).resolves.toBe(0);
    await expect(core.prisma.credential.count({ where: { shipId: scoutId, invalidatedAt: null } })).resolves.toBe(0);
    await expect(stored(direct.deliveryId)).resolves.toMatchObject({ state: 'abandoned' });
    await expect(stored(toType.deliveryId)).resolves.toMatchObject({ state: 'pending', claimedByShipId: null });
    await expect(core.useCases.receiveDeliveries(lookout, { max: 1 })).resolves.toMatchObject({
      value: { deliveries: [{ deliveryId: toType.deliveryId }] },
    });
    const events = await core.prisma.event.findMany({ where: { shipId: scoutId }, orderBy: { seq: 'asc' } });
    expect(events.map((event) => event.type).slice(-5)).toEqual([
      'CredentialRevoked',
      'LeaseRevoked',
      'DeliveryReturned',
      'ShipRetired',
      'DeliveryAbandoned',
    ]);
  });

  it('is never claimed or addressed again, and its name is free', async () => {
    unwrap(await core.useCases.retireShip(argo, { shipId: scoutId }));

    await expect(
      core.useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: { kind: 'DEVICE' }, harness: 'claude-code' }),
    ).resolves.toMatchObject({ isOk: false });
    await expect(
      core.useCases.sendMessage(argo, { selector: { kind: 'ship', name: 'scout' }, payload: 'Hi', idempotencyKey: 'by-name' }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'UNRESOLVABLE_SELECTOR' } });
    await expect(core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })).resolves.toMatchObject({ isOk: true });
  });

  it('keeps an undeliverable direct delivery undeliverable', async () => {
    const { deliveryId } = await sendTo({ kind: 'ship', shipId: scoutId });
    await core.prisma.delivery.update({ where: { id: deliveryId }, data: { state: 'undeliverable' } });

    unwrap(await core.useCases.retireShip(argo, { shipId: scoutId }));

    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'undeliverable' });
  });
});

describe('a send racing a retire', () => {
  it('waits for a retire that locked the ship first, then is refused: the ship is retired', async () => {
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      inFlightDeliveries: {
        ...tx.inFlightDeliveries,
        abandonPendingTo: async (fleetId, shipId) => {
          await hold();
          return tx.inFlightDeliveries.abandonPendingTo(fleetId, shipId);
        },
      },
    }));
    const retire = createRetireShip({ uow, clock: core.clock, ids: newId })(argo, { shipId: scoutId });
    await reached;

    const send = core.useCases.sendMessage(argo, {
      selector: { kind: 'ship', shipId: scoutId },
      payload: 'Too late',
      idempotencyKey: 'racing-after',
    });

    await expect(retire).resolves.toEqual({ isOk: true, value: { abandonedDeliveries: 0 } });
    await expect(send).resolves.toMatchObject({ isOk: false, error: { kind: 'UNRESOLVABLE_SELECTOR' } });
    await expect(core.prisma.delivery.count({ where: { recipientShipId: scoutId } })).resolves.toBe(0);
  });

  it('makes a retire wait for a send that holds the ship, then abandons what the send stored', async () => {
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      deliveries: {
        ...tx.deliveries,
        create: async (delivery) => {
          await tx.deliveries.create(delivery);
          await hold();
        },
      },
    }));
    const send = createSendMessage({ uow, clock: core.clock, ids: newId, hasher: sha256Hasher })(argo, {
      selector: { kind: 'ship', shipId: scoutId },
      payload: 'Just in time',
      idempotencyKey: 'racing-before',
    });
    await reached;

    const retire = core.useCases.retireShip(argo, { shipId: scoutId });

    const sent = unwrap(await send);
    await expect(retire).resolves.toEqual({ isOk: true, value: { abandonedDeliveries: 1 } });
    await expect(core.prisma.delivery.findFirstOrThrow({ where: { messageId: sent.messageId } })).resolves.toMatchObject({
      state: 'abandoned',
    });
  });
});

describe('re-crewing a ship on Postgres', () => {
  it('ends the crew, returns what it held, and hands out a new prompt whose secret claims the ship', async () => {
    const scout = await crew(scoutId, scoutSecret);
    const { deliveryId } = await sendTo({ kind: 'ship', shipId: scoutId });
    unwrap(await core.useCases.receiveDeliveries(scout, { max: 1 }));

    const issued = unwrap(await core.useCases.recrewShip(argo, { shipId: scoutId }));

    await expect(core.useCases.receiveDeliveries(scout, {})).resolves.toMatchObject({ error: { kind: 'LEASE_ENDED' } });
    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'pending' });
    await expect(crew(scoutId, secretOf(issued.secret))).resolves.toMatchObject({ shipId: scoutId });
  });
});
