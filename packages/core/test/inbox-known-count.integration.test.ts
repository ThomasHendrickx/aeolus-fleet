import { idSchema, type DeliveryId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { listenForPendingDeliveries, type DeliveryListener } from '../src/adapters/prisma/delivery-notices.js';
import { createFleetEventWakeups, fleetEventWakeupsOf } from '../src/adapters/prisma/fleet-event-wakeups.js';
import { createReceiverWakeups } from '../src/adapters/prisma/receiver-wakeups.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createCheckInbox } from '../src/domain/messaging/check-inbox.js';
import type { ShipCaller, Crew } from '../src/domain/shared/caller.js';
import type { FleetEventWakeups } from '../src/domain/shared/events.js';
import type { ReceiverWakeups } from '../src/domain/messaging/ports.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { createUseCases, systemClock, type UseCases } from '../src/wiring.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { unwrap } from '../src/testing/result.js';
import { newKey } from '../src/testing/keys.js';
import { withOperatorLogin } from './support/operator-login.js';

// An inbox check with the count the crew knows (W5), on a real Postgres with
// the listener and both wake-ups the server runs: it waits while the count is
// still that, answers as soon as a send or an ack commits, answers at once
// when the count already differs, counts a send that commits between its
// first look and its watch, claims and records nothing, and refuses an ended
// lease.

/** A wait that must end early: answering before it proves a wake-up, not a timeout. */
const LONG_WAIT_SECONDS = 15;
const LONG_WAIT_MS = LONG_WAIT_SECONDS * 1_000;
/** A wait that must run out. */
const SHORT_WAIT_SECONDS = 2;
const SHORT_WAIT_MS = SHORT_WAIT_SECONDS * 1_000;
/** Time for a check to start waiting before the test changes the count. */
const SETTLE_MS = 300;
/** Leeway for timers that fire a little early. */
const TIMER_LEEWAY_MS = 50;

let prisma: PrismaClient;
let wakeups: ReceiverWakeups;
let fleetNews: FleetEventWakeups;
let listener: DeliveryListener;
let useCases: UseCases;
let argo: ShipCaller;
let scout: Crew;

beforeEach(async () => {
  const databaseUrl = await createMigratedDatabase();
  prisma = createPrismaClient(databaseUrl);
  const receiverHub = createReceiverWakeups();
  const fleetHub = createFleetEventWakeups();
  wakeups = receiverHub;
  fleetNews = fleetEventWakeupsOf(fleetHub);
  listener = listenForPendingDeliveries({
    databaseUrl,
    onNotice: (notice) => {
      receiverHub.deliveryPending(notice);
    },
    onFleetEvent: (notice) => {
      fleetHub.eventCommitted(notice);
    },
    onListening: () => {
      receiverHub.wakeAll();
      fleetHub.wakeAll();
    },
  });
  await listener.listening;
  useCases = createUseCases({ prisma, clock: systemClock, wakeups, fleetEventWakeups: fleetNews });
  const fleet = unwrap(await withOperatorLogin(prisma, useCases.initialiseFleet({ name: 'home fleet' })));
  argo = operatorCaller(fleet);
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  const { crewToken } = unwrap(
    await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }),
  );
  scout = unwrap(await useCases.authenticate.byCrewToken(crewToken));
});

afterEach(async () => {
  await listener.close();
  await prisma.$disconnect();
});

/** Sends argo's plain-text message to the scout and returns its delivery's id. */
async function sendToScout(): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(argo, {
      selector: { kind: 'ship', shipId: scout.shipId },
      payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/25',
      idempotencyKey: newKey(),
    }),
  );
  const { id } = await prisma.delivery.findFirstOrThrow({ where: { messageId } });
  return idSchema('delivery').parse(id);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('checking the inbox with the count the crew knows, on Postgres (W5)', () => {
  it('waits while the count is still the one it knows, then answers it', async () => {
    await sendToScout();
    const startedAt = performance.now();

    await expect(useCases.checkInbox(scout, { waitSeconds: SHORT_WAIT_SECONDS, knownWaiting: 1 })).resolves.toEqual({
      isOk: true,
      value: { waiting: 1, forced: 0 },
    });
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(SHORT_WAIT_MS - TIMER_LEEWAY_MS);
  });

  it('answers as soon as a delivery commits while it waits', async () => {
    await sendToScout();
    const startedAt = performance.now();
    const checking = useCases.checkInbox(scout, { waitSeconds: LONG_WAIT_SECONDS, knownWaiting: 1 });
    await pause(SETTLE_MS);

    await sendToScout();

    await expect(checking).resolves.toEqual({ isOk: true, value: { waiting: 2, forced: 0 } });
    expect(performance.now() - startedAt).toBeLessThan(LONG_WAIT_MS);
  });

  it('answers as soon as the count goes down while it waits: the crew acknowledged one', async () => {
    const deliveryId = await sendToScout();
    unwrap(await useCases.receiveDeliveries(scout, {}));
    const startedAt = performance.now();
    const checking = useCases.checkInbox(scout, { waitSeconds: LONG_WAIT_SECONDS, knownWaiting: 1 });
    await pause(SETTLE_MS);

    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));

    await expect(checking).resolves.toEqual({ isOk: true, value: { waiting: 0, forced: 0 } });
    expect(performance.now() - startedAt).toBeLessThan(LONG_WAIT_MS);
  });

  it('answers at once when the count already differs from the one it knows', async () => {
    await sendToScout();
    const startedAt = performance.now();

    await expect(useCases.checkInbox(scout, { waitSeconds: LONG_WAIT_SECONDS, knownWaiting: 0 })).resolves.toEqual({
      isOk: true,
      value: { waiting: 1, forced: 0 },
    });
    expect(performance.now() - startedAt).toBeLessThan(SETTLE_MS);
  });

  it('counts a delivery that commits between its first look and its watch', async () => {
    const committed = createPrismaUnitOfWork(prisma);
    let isFirstLook = true;
    // The send commits after the first look counted and before the watch
    // starts, so its notice reaches no watch: only a second look finds it.
    const uow: UnitOfWork<PrismaTx> = {
      run: (work) =>
        committed.run((tx) =>
          work({
            ...tx,
            deliveries: {
              ...tx.deliveries,
              countReceivable: async (query) => {
                const count = await tx.deliveries.countReceivable(query);
                if (isFirstLook) {
                  isFirstLook = false;
                  await sendToScout();
                }
                return count;
              },
            },
          }),
        ),
    };
    const checkInbox = createCheckInbox({ uow, clock: systemClock, wakeups, fleetNews });
    const startedAt = performance.now();

    await expect(checkInbox(scout, { waitSeconds: LONG_WAIT_SECONDS, knownWaiting: 0 })).resolves.toEqual({
      isOk: true,
      value: { waiting: 1, forced: 0 },
    });
    expect(performance.now() - startedAt).toBeLessThan(LONG_WAIT_MS);
  });

  it('claims nothing and records nothing', async () => {
    const deliveryId = await sendToScout();
    const events = await prisma.event.count();

    unwrap(await useCases.checkInbox(scout, { waitSeconds: SHORT_WAIT_SECONDS, knownWaiting: 1 }));

    await expect(prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).resolves.toMatchObject({
      state: 'pending',
      attempts: 0,
      claimedByLeaseId: null,
    });
    await expect(prisma.event.count()).resolves.toBe(events);
  });

  it('refuses a crew whose lease has ended', async () => {
    unwrap(await useCases.releaseShip(argo, { shipId: scout.shipId }));

    await expect(useCases.checkInbox(scout, { waitSeconds: LONG_WAIT_SECONDS, knownWaiting: 0 })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'LEASE_ENDED' },
    });
  });

  it('refuses as soon as the lease ends while it waits', async () => {
    const startedAt = performance.now();
    const checking = useCases.checkInbox(scout, { waitSeconds: LONG_WAIT_SECONDS, knownWaiting: 0 });
    await pause(SETTLE_MS);

    unwrap(await useCases.releaseShip(argo, { shipId: scout.shipId }));

    await expect(checking).resolves.toMatchObject({ isOk: false, error: { kind: 'LEASE_ENDED' } });
    expect(performance.now() - startedAt).toBeLessThan(LONG_WAIT_MS);
  });
});
