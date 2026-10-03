import { createIdGenerator, idSchema, PING_CONTENT_TYPE, type DeliveryId, type MessageId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createAnswerPing } from '../src/core/messaging/answer-ping.js';
import { createPingShip } from '../src/core/messaging/ping-ship.js';
import type { Caller, Crew } from '../src/core/shared/caller.js';
import { OPERATOR, operatorCaller, secretIn } from './support/core-fixtures.js';
import { createPostgresCore, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// Ping and pong on a real Postgres: what a ping stores, that pings racing for
// one ship store one, and that a pong acknowledges the ping and marks the
// lease seen in one transaction, or neither.

const ids = createIdGenerator();

let core: PostgresCore;
let argo: Caller;
let scout: Crew;

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const { shipId, prompt } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  const { crewToken } = unwrap(
    await core.useCases.claimShip({ shipId, secret: secretIn(prompt), location: { kind: 'DEVICE' }, harness: 'claude-code' }),
  );
  scout = unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
  core.clock.advance(60_000);
});

afterEach(async () => {
  await core.close();
});

async function deliveryOf(messageId: MessageId): Promise<DeliveryId> {
  const { id } = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
  return idSchema('delivery').parse(id);
}

async function lastSeen(): Promise<Date | null> {
  return (await core.prisma.lease.findUniqueOrThrow({ where: { id: scout.leaseId } })).lastSeenAt;
}

/** Pings the scout and has its session receive the ping; answers the delivery's id. */
async function pingReceived(): Promise<DeliveryId> {
  const { messageId } = unwrap(await core.useCases.pingShip(argo, { shipId: scout.shipId }));
  unwrap(await core.useCases.receiveDeliveries(scout, {}));
  core.clock.advance(4_000);
  return deliveryOf(messageId);
}

describe('a ping on Postgres', () => {
  it('stores a message with the ping content type from argo, and its delivery pending for the ship', async () => {
    const { messageId } = unwrap(await core.useCases.pingShip(argo, { shipId: scout.shipId }));

    await expect(core.prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      senderShipId: argo.shipId,
      contentType: PING_CONTENT_TYPE,
    });
    await expect(core.prisma.delivery.findFirstOrThrow({ where: { messageId } })).resolves.toMatchObject({
      recipientShipId: scout.shipId,
      state: 'pending',
    });
  });

  it('answers the ping already open instead of storing another', async () => {
    const first = unwrap(await core.useCases.pingShip(argo, { shipId: scout.shipId }));

    const again = unwrap(await core.useCases.pingShip(argo, { shipId: scout.shipId }));

    expect(again).toMatchObject({ messageId: first.messageId, isNew: false });
    await expect(core.prisma.message.count({ where: { contentType: PING_CONTENT_TYPE } })).resolves.toBe(1);
  });

  it('stores one ping when pings for one ship race, even while each looks for an open one', async () => {
    const racing = createPingShip({
      uow: racingUnitOfWork({ prisma: core.prisma, transactions: 2 }, (tx, allArrived) => ({
        ...tx,
        deliveries: {
          ...tx.deliveries,
          findOpenPing: async (fleetId, shipId) => {
            const open = await tx.deliveries.findOpenPing(fleetId, shipId);
            await allArrived();
            return open;
          },
        },
      })),
      clock: core.clock,
      ids,
      hasher: sha256Hasher,
    });

    const [one, other] = await Promise.all([
      racing(argo, { shipId: scout.shipId }),
      racing(argo, { shipId: scout.shipId }),
    ]);

    expect(unwrap(one).messageId).toBe(unwrap(other).messageId);
    expect([unwrap(one).isNew, unwrap(other).isNew].sort()).toEqual([false, true]);
    await expect(core.prisma.message.count({ where: { contentType: PING_CONTENT_TYPE } })).resolves.toBe(1);
  });
});

describe('a pong on Postgres', () => {
  it("acknowledges the ping and sets the lease's last seen to that moment", async () => {
    const deliveryId = await pingReceived();

    unwrap(await core.useCases.answerPing(scout, { deliveryId }));

    await expect(core.prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).resolves.toMatchObject({
      state: 'acknowledged',
    });
    await expect(lastSeen()).resolves.toEqual(core.clock.now());
  });

  it('stores neither the acknowledgement nor last seen when the transaction fails', async () => {
    const deliveryId = await pingReceived();
    const seenBefore = await lastSeen();
    const uow = createPrismaUnitOfWork(core.prisma);
    const failing = createAnswerPing({
      uow: {
        run: (work) =>
          uow.run((tx) =>
            work({
              ...tx,
              events: {
                append: () => Promise.reject(new Error('the event log is down')),
              },
            }),
          ),
      },
      clock: core.clock,
      ids,
    });

    await expect(failing(scout, { deliveryId })).rejects.toThrow('the event log is down');

    await expect(core.prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).resolves.toMatchObject({
      state: 'delivered',
    });
    await expect(lastSeen()).resolves.toEqual(seenBefore);
  });
});

describe("a ship's last ping in the listing on Postgres", () => {
  async function listedScout() {
    return (await core.useCases.listFleet(argo)).find((ship) => ship.id === scout.shipId);
  }

  it('waits while the ping is open, then is answered at the moment of the pong', async () => {
    const sentAt = core.clock.now();
    const { messageId } = unwrap(await core.useCases.pingShip(argo, { shipId: scout.shipId }));
    await expect(listedScout()).resolves.toMatchObject({ ping: { state: 'waiting', sentAt, answeredAt: null } });
    unwrap(await core.useCases.receiveDeliveries(scout, {}));
    core.clock.advance(4_000);

    unwrap(await core.useCases.answerPing(scout, { deliveryId: await deliveryOf(messageId) }));

    await expect(listedScout()).resolves.toMatchObject({
      ping: { state: 'answered', sentAt, answeredAt: core.clock.now() },
    });
  });

  it('is received, not answered with pong, after a plain ack, and shows on the ship too', async () => {
    const { messageId } = unwrap(await core.useCases.pingShip(argo, { shipId: scout.shipId }));
    unwrap(await core.useCases.receiveDeliveries(scout, {}));

    unwrap(await core.useCases.acknowledgeDelivery(scout, { deliveryId: await deliveryOf(messageId) }));

    await expect(core.useCases.getShip(argo, { shipId: scout.shipId })).resolves.toMatchObject({
      isOk: true,
      value: { ping: { state: 'received', answeredAt: null } },
    });
  });
});
