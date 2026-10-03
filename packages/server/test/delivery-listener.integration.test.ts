import { createIdGenerator } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import {
  LISTENER_APPLICATION_NAME,
  listenForPendingDeliveries,
  type DeliveryListener,
} from '../src/adapters/prisma/delivery-notices.js';
import { createReceiverWakeups, type ReceiverWakeupHub } from '../src/adapters/prisma/receiver-wakeups.js';
import type { Caller, Crew } from '../src/core/shared/caller.js';
import { createUseCases, systemClock, type UseCases } from '../src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretIn } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// The delivery listener losing its database connection: it never throws,
// listens again, and wakes every waiting receive when it does, so a delivery
// sent while it did not listen is still found at once. A receive waiting
// meanwhile returns within its wait.

const newId = createIdGenerator();
/** The listener's first retry comes this soon in these tests. */
const RECONNECT_DELAY_MS = 200;
/** A receive that must end early: it proves a wake-up, not a timeout. */
const LONG_WAIT_MS = 15_000;
/** A receive that must end at its wait. */
const SHORT_WAIT_MS = 2_000;
/** Time for a receive to start waiting. */
const SETTLE_MS = 300;

let databaseUrl: string;
let prisma: PrismaClient;
let wakeups: ReceiverWakeupHub;
let listener: DeliveryListener;
let listens: number;
let errors: Error[];
let argo: Caller;
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
  const useCases = wired(SHORT_WAIT_MS);
  const fleet = unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  argo = operatorCaller(fleet);
  const { shipId, prompt } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretIn(prompt), location: { kind: 'CLOUD' } }));
  scout = unwrap(await useCases.authenticate.byCrewToken(crewToken));
});

afterEach(async () => {
  await listener.close();
  await prisma.$disconnect();
});

function wired(receiveWaitMs: number): UseCases {
  return createUseCases({ prisma, clock: systemClock, fleetUrl: FLEET_URL, wakeups, receiveWaitMs });
}

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
    await wired(SHORT_WAIT_MS).sendMessage(argo, {
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

  it('wakes a waiting receive for a send once it listens again after its connection was killed', async () => {
    await killListenerConnection();
    await vi.waitFor(
      () => {
        expect(listens).toBe(2);
      },
      { timeout: 10_000 },
    );
    const startedAt = performance.now();
    const receiving = wired(LONG_WAIT_MS).receiveDeliveries(scout, {});
    await pause(SETTLE_MS);

    const deliveryId = await sendToScout();

    expect(unwrap(await receiving).deliveries.map((delivery) => delivery.deliveryId)).toEqual([deliveryId]);
    expect(performance.now() - startedAt).toBeLessThan(LONG_WAIT_MS / 2);
  });

  it('finds a delivery sent while it did not listen as soon as it listens again', async () => {
    const startedAt = performance.now();
    const receiving = wired(LONG_WAIT_MS).receiveDeliveries(scout, {});
    await pause(SETTLE_MS);
    await killListenerConnection();
    await vi.waitFor(() => {
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });

    const deliveryId = await sendToScout();

    expect(unwrap(await receiving).deliveries.map((delivery) => delivery.deliveryId)).toEqual([deliveryId]);
    expect(performance.now() - startedAt).toBeLessThan(LONG_WAIT_MS / 2);
    expect(listens).toBe(2);
  });

  it('lets a receive waiting while it reconnects return within its wait', async () => {
    const startedAt = performance.now();
    const receiving = wired(SHORT_WAIT_MS).receiveDeliveries(scout, {});
    await pause(SETTLE_MS);

    await killListenerConnection();

    await expect(receiving).resolves.toEqual({ isOk: true, value: { deliveries: [] } });
    expect(performance.now() - startedAt).toBeLessThan(SHORT_WAIT_MS + 1_000);
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
