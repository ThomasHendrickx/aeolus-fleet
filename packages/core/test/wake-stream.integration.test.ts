import { createIdGenerator, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { listenForPendingDeliveries, type DeliveryListener } from '../src/adapters/prisma/delivery-notices.js';
import { createReceiverWakeups } from '../src/adapters/prisma/receiver-wakeups.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createSendMessage, type MessageToSend } from '../src/domain/messaging/send-message.js';
import type { WakeStreamItem } from '../src/domain/messaging/watch-wakeups.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import type { DeliveryNotice } from '../src/domain/shared/notifier.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { unsealedFleetsOnly } from './support/sealing.js';

// The wake stream on Postgres (long-poll design, W1): from a send's commit,
// through the delivery listener's NOTIFY and the hub, to the stream's wake.
// A send that rolls back sends no NOTIFY, so it wakes nothing.

const newId = createIdGenerator();
const MODEL = 'claude-opus-5-5';
/** Long enough for a notice that was sent to have come through the listener. */
const HEARD_MS = 500;

let prisma: PrismaClient;
let useCases: UseCases;
let listener: DeliveryListener;
let notices: DeliveryNotice[];
let argo: ShipCaller;
let scout: Crew;
let lookoutId: ShipId;
let closing: AbortController;

async function commissioned(name: string, type: string): Promise<ShipId> {
  return unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type })).shipId;
}

async function crewOf(shipId: ShipId): Promise<Crew> {
  const { secret } = unwrap(await useCases.getStartingPrompt(argo, { shipId }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return unwrap(await useCases.authenticate.byCrewToken(crewToken));
}

beforeEach(async () => {
  const databaseUrl = await createMigratedDatabase();
  prisma = createPrismaClient(databaseUrl);
  const hub = createReceiverWakeups();
  useCases = createUseCases({ prisma, wakeStreams: hub });
  const fleet = unwrap(await withOperatorLogin(prisma, useCases.initialiseFleet({ name: 'home fleet' })));
  argo = operatorCaller(fleet);
  scout = await crewOf(await commissioned('scout', 'reviewer'));
  lookoutId = await commissioned('lookout', 'reviewer');
  notices = [];
  listener = listenForPendingDeliveries({
    databaseUrl,
    onNotice: (notice) => {
      notices.push(notice);
      hub.deliveryPending(notice);
    },
    onListening: () => {
      hub.wakeAll();
    },
  });
  await listener.listening;
  closing = new AbortController();
});

afterEach(async () => {
  closing.abort();
  await listener.close();
  await prisma.$disconnect();
});

function aSend(selector: MessageToSend['selector']): MessageToSend {
  return { selector, payload: 'Review PR 1551', idempotencyKey: newKey(), model: MODEL };
}

/** The scout's stream, its open wake read. */
async function openedStream(): Promise<AsyncIterator<WakeStreamItem>> {
  const stream = unwrap(await useCases.watchWakeups(scout, closing.signal))[Symbol.asyncIterator]();
  await expect(stream.next()).resolves.toEqual({ done: false, value: { kind: 'wake', reason: 'open' } });
  return stream;
}

describe('the wake stream on Postgres', () => {
  it("wakes once a send to its ship commits, through the listener's notice", async () => {
    const stream = await openedStream();

    unwrap(await useCases.sendMessage(argo, aSend({ kind: 'ship', shipId: scout.shipId })));

    await expect(stream.next()).resolves.toEqual({ done: false, value: { kind: 'wake', reason: 'notice' } });
  });

  it('wakes once a send to its type commits', async () => {
    const stream = await openedStream();

    unwrap(await useCases.sendMessage(argo, aSend({ kind: 'type', type: 'reviewer' })));

    await expect(stream.next()).resolves.toEqual({ done: false, value: { kind: 'wake', reason: 'notice' } });
  });

  it("wakes once a lease's end returns a delivery of its type to pending", async () => {
    const lookout = await crewOf(lookoutId);
    unwrap(await useCases.sendMessage(argo, aSend({ kind: 'type', type: 'reviewer' })));
    unwrap(await useCases.receiveDeliveries(lookout, {}));
    const stream = await openedStream();

    unwrap(await useCases.releaseShip(argo, { shipId: lookoutId }));

    await expect(stream.next()).resolves.toEqual({ done: false, value: { kind: 'wake', reason: 'notice' } });
  });

  it('wakes nothing for a send that rolled back after its notice was queued', async () => {
    const stream = await openedStream();
    const uow = createPrismaUnitOfWork(prisma);
    const failing = (tx: PrismaTx): PrismaTx => ({
      ...tx,
      notifier: {
        deliveryPending: async (notice) => {
          await tx.notifier.deliveryPending(notice);
          throw new Error('disk full');
        },
      },
    });
    const sendRolledBack = createSendMessage({ uow: { run: (work) => uow.run((tx) => work(failing(tx))) }, clock: { now: () => new Date() }, ids: newId, hasher: sha256Hasher, sealing: unsealedFleetsOnly });
    const woken = stream.next();

    await expect(sendRolledBack(argo, aSend({ kind: 'ship', shipId: scout.shipId }))).rejects.toThrow('disk full');

    // A send to another ship after it is heard: had the rolled-back send's notice gone out, it would be heard first.
    const { messageId } = unwrap(await useCases.sendMessage(argo, aSend({ kind: 'ship', shipId: lookoutId })));
    const probe = await prisma.delivery.findFirstOrThrow({ where: { messageId } });
    await expect.poll(() => notices.map((notice) => notice.deliveryId)).toEqual([probe.id]);
    const outcome = await Promise.race([woken.then(() => 'woken'), new Promise((resolve) => setTimeout(resolve, HEARD_MS, 'still waiting'))]);
    expect(outcome).toBe('still waiting');
  });
});
