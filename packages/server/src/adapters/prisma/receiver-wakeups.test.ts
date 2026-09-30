import { createIdGenerator } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReceiverWakeups, type ReceiverWakeupHub } from './receiver-wakeups.js';

const newId = createIdGenerator();
const fleetId = newId('fleet');
const scoutId = newId('ship');
const scout = { fleetId, shipId: scoutId, type: 'reviewer' };

let hub: ReceiverWakeupHub;

beforeEach(() => {
  vi.useFakeTimers();
  hub = createReceiverWakeups();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A notice of a pending delivery for the given recipient in the fleet. */
function pendingFor(recipient: { kind: 'ship'; shipId: typeof scoutId } | { kind: 'type'; type: string }, fleet = fleetId) {
  return { fleetId: fleet, deliveryId: newId('delivery'), recipient };
}

describe('the wake-ups of waiting receives', () => {
  it('wake a receive watching the ship a delivery is pending for', async () => {
    const waiting = hub.watch(scout).next(25_000);

    hub.deliveryPending(pendingFor({ kind: 'ship', shipId: scoutId }));

    await expect(waiting).resolves.toBe('woken');
  });

  it("wake a receive watching the ship's type when a type delivery is pending", async () => {
    const waiting = hub.watch(scout).next(25_000);

    hub.deliveryPending(pendingFor({ kind: 'type', type: 'reviewer' }));

    await expect(waiting).resolves.toBe('woken');
  });

  it('leave a receive waiting when the delivery is for another ship, another type or another fleet', async () => {
    const waiting = hub.watch(scout).next(25_000);

    hub.deliveryPending(pendingFor({ kind: 'ship', shipId: newId('ship') }));
    hub.deliveryPending(pendingFor({ kind: 'type', type: 'builder' }));
    hub.deliveryPending(pendingFor({ kind: 'ship', shipId: scoutId }, newId('fleet')));
    await vi.advanceTimersByTimeAsync(25_000);

    await expect(waiting).resolves.toBe('timedOut');
  });

  it('end a wait once its time has passed, and not before', async () => {
    const outcomes: string[] = [];
    void hub
      .watch(scout)
      .next(25_000)
      .then((outcome) => outcomes.push(outcome));

    await vi.advanceTimersByTimeAsync(24_999);
    expect(outcomes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(outcomes).toEqual(['timedOut']);
  });

  it('keep a wake-up that comes before the wait, so the wait ends at once', async () => {
    const watch = hub.watch(scout);
    hub.deliveryPending(pendingFor({ kind: 'ship', shipId: scoutId }));

    await expect(watch.next(25_000)).resolves.toBe('woken');
  });

  it('keep one wake-up for one wait: the wait after it waits again', async () => {
    const watch = hub.watch(scout);
    hub.deliveryPending(pendingFor({ kind: 'ship', shipId: scoutId }));
    hub.deliveryPending(pendingFor({ kind: 'type', type: 'reviewer' }));
    await watch.next(25_000);

    const waiting = watch.next(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(waiting).resolves.toBe('timedOut');
  });

  it('wake every waiting receive when the listener listens again', async () => {
    const waiting = [hub.watch(scout).next(25_000), hub.watch({ ...scout, shipId: newId('ship') }).next(25_000)];

    hub.wakeAll();

    await expect(Promise.all(waiting)).resolves.toEqual(['woken', 'woken']);
  });

  it('forget a watch once it stops', async () => {
    const watch = hub.watch(scout);
    watch.stop();
    hub.deliveryPending(pendingFor({ kind: 'ship', shipId: scoutId }));

    const waiting = watch.next(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(waiting).resolves.toBe('timedOut');
  });

});
