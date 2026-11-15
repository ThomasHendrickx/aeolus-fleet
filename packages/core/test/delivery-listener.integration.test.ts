import { createIdGenerator } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import {
  LISTENER_APPLICATION_NAME,
  listenForPendingDeliveries,
  type DeliveryListener,
} from '../src/adapters/prisma/delivery-notices.js';
import { createReceiverWakeups, type ReceiverWakeupHub } from '../src/adapters/prisma/receiver-wakeups.js';
import type { WakeStreamItem } from '../src/domain/messaging/watch-wakeups.js';
import type { ShipCaller, Crew } from '../src/domain/shared/caller.js';
import { createUseCases, systemClock, type UseCases } from '../src/wiring.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { unwrap } from '../src/testing/result.js';
import { newKey } from '../src/testing/keys.js';
import { withOperatorLogin } from './support/operator-login.js';

// The delivery listener losing its database connection: it never throws,
// listens again, and wakes every open wake stream when it does, so a delivery
// sent while it did not listen is still found at the look that wake starts.

const newId = createIdGenerator();
/** The listener's first retry comes this soon in these tests. */
const RECONNECT_DELAY_MS = 200;

let databaseUrl: string;
let prisma: PrismaClient;
let wakeups: ReceiverWakeupHub;
let useCases: UseCases;
let closing: AbortController;
let listener: DeliveryListener;
let listens: number;
let errors: Error[];
let argo: ShipCaller;
let scout: Crew;

beforeEach(async () => {
  databaseUrl = await createMigratedDatabase();
  prisma = createPrismaClient(databaseUrl);
  wakeups = createReceiverWakeups();
  listens = 0;
  errors = [];
  listener = listenForPendingDeliveries({
    databaseUrl,
    onNotice: (notice) => {
      wakeups.deliveryPending(notice);
    },
    onListening: () => {
      listens += 1;
      wakeups.wakeAll();
    },
    onError: (error) => {
      errors.push(error);
    },
    reconnectDelayMs: RECONNECT_DELAY_MS,
  });
  await listener.listening;
  useCases = createUseCases({ prisma, clock: systemClock, wakeStreams: wakeups });
  closing = new AbortController();
  const fleet = unwrap(await withOperatorLogin(prisma, useCases.initialiseFleet({ name: 'home fleet' })));
  argo = operatorCaller(fleet);
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  scout = unwrap(await useCases.authenticate.byCrewToken(crewToken));
});

afterEach(async () => {
  closing.abort();
  await listener.close();
  await prisma.$disconnect();
});

/** Ends the listener's database connection from the server side, as a restart of Postgres or a network cut would. */
async function killListenerConnection(): Promise<void> {
  // Found first, then ended: Postgres may evaluate the conditions of one WHERE in any order.
  const listeners = await prisma.$queryRaw<{ pid: number }[]>`
    SELECT pid FROM pg_stat_activity
    WHERE application_name = ${LISTENER_APPLICATION_NAME} AND datname = current_database()`;
  expect(listeners).toHaveLength(1);
  for (const { pid } of listeners) {
    await prisma.$queryRaw`SELECT pg_terminate_backend(${pid})`;
  }
}

async function sendToScout(): Promise<string> {
  const { messageId } = unwrap(
    await useCases.sendMessage(argo, {
      selector: { kind: 'ship', shipId: scout.shipId },
      payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/25',
      contentType: 'text/plain',
      idempotencyKey: `review-${newId('message')}`,
    }),
  );
  return (await prisma.delivery.findFirstOrThrow({ where: { messageId } })).id;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The scout's wake stream, its open wake read. */
async function openedStream(): Promise<AsyncIterator<WakeStreamItem>> {
  const stream = unwrap(await useCases.watchWakeups(scout, closing.signal))[Symbol.asyncIterator]();
  await expect(stream.next()).resolves.toEqual({ done: false, value: { kind: 'wake', reason: 'open' } });
  return stream;
}

describe('the delivery listener', () => {
  it('reports a killed connection, never throws, and listens again', async () => {
    await killListenerConnection();

    await vi.waitFor(
      () => {
        expect(listens).toBe(2);
      },
      { timeout: 10_000 },
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('wakes an open wake stream for a send once it listens again after its connection was killed', async () => {
    await killListenerConnection();
    await vi.waitFor(
      () => {
        expect(listens).toBe(2);
      },
      { timeout: 10_000 },
    );
    const stream = await openedStream();
    await expect(stream.next()).resolves.toEqual({ done: false, value: { kind: 'wake', reason: 'reconnect' } });

    await sendToScout();

    await expect(stream.next()).resolves.toEqual({ done: false, value: { kind: 'wake', reason: 'notice' } });
  });

  it('wakes an open wake stream once it listens again, and the look finds a delivery sent while it did not listen', async () => {
    const stream = await openedStream();
    await killListenerConnection();
    await expect.poll(() => errors.length).toBeGreaterThanOrEqual(1);

    const deliveryId = await sendToScout();

    await expect(stream.next()).resolves.toEqual({ done: false, value: { kind: 'wake', reason: 'reconnect' } });
    expect(unwrap(await useCases.receiveDeliveries(scout, {})).deliveries.map((delivery) => delivery.deliveryId)).toEqual([deliveryId]);
    expect(listens).toBe(2);
  });

  it('keeps trying, without throwing, while the database cannot be reached, and stops once closed', async () => {
    const unreachable: Error[] = [];
    const unreachableUrl = new URL(databaseUrl);
    unreachableUrl.port = '1';
    const stranded = listenForPendingDeliveries({
      databaseUrl: unreachableUrl.toString(),
      onNotice: () => undefined,
      onError: (error) => {
        unreachable.push(error);
      },
      reconnectDelayMs: RECONNECT_DELAY_MS,
    });

    await vi.waitFor(
      () => {
        expect(unreachable.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 10_000 },
    );
    await stranded.close();
    const attempts = unreachable.length;
    await pause(RECONNECT_DELAY_MS * 4);

    expect(unreachable).toHaveLength(attempts);
  });
});
