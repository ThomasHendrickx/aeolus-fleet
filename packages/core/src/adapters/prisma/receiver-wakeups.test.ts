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


  it('end every waiting receive at once when the server stops, as if its time had passed', async () => {
    const waiting = hub.watch(scout).next(25_000);
    const waitingOfType = hub.watch({ fleetId, shipId: newId('ship'), type: 'builder' }).next(25_000);

    hub.endAll();

    await expect(waiting).resolves.toBe('timedOut');
    await expect(waitingOfType).resolves.toBe('timedOut');
  });

  it('end at once a wait that starts after the server began to stop', async () => {
    const watch = hub.watch(scout);

    hub.endAll();

    await expect(watch.next(25_000)).resolves.toBe('timedOut');
    await expect(hub.watch(scout).next(25_000)).resolves.toBe('timedOut');
  });
});

describe('the wake streams', () => {
  const KEEP_ALIVE_MS = 25_000;
  const open = () => new AbortController().signal;

  function streamOf(address = scout) {
    return hub.open(address) ?? expect.unreachable('the hub refused a stream before the server stopped');
  }

  it.each([
    ['its ship', { kind: 'ship' as const, shipId: scoutId }],
    ['its type', { kind: 'type' as const, type: 'reviewer' }],
  ])('wake a stream for a delivery pending for %s', async (_for, recipient) => {
    const waiting = streamOf().next(KEEP_ALIVE_MS, open());

    hub.deliveryPending(pendingFor(recipient));

    await expect(waiting).resolves.toBe('notice');
  });

  it('never wake a stream for another ship, another type or another fleet', async () => {
    const waiting = streamOf().next(KEEP_ALIVE_MS, open());

    hub.deliveryPending(pendingFor({ kind: 'ship', shipId: newId('ship') }));
    hub.deliveryPending(pendingFor({ kind: 'type', type: 'builder' }));
    hub.deliveryPending(pendingFor({ kind: 'ship', shipId: scoutId }, newId('fleet')));
    hub.deliveryPending(pendingFor({ kind: 'type', type: 'reviewer' }, newId('fleet')));
    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_MS);

    await expect(waiting).resolves.toBe('timedOut');
  });

  it('wake a stream once per notice, those that came while it was not waiting kept for its next waits', async () => {
    const stream = streamOf();
    hub.deliveryPending(pendingFor({ kind: 'ship', shipId: scoutId }));
    hub.deliveryPending(pendingFor({ kind: 'type', type: 'reviewer' }));

    await expect(stream.next(KEEP_ALIVE_MS, open())).resolves.toBe('notice');
    await expect(stream.next(KEEP_ALIVE_MS, open())).resolves.toBe('notice');
    const third = stream.next(KEEP_ALIVE_MS, open());
    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_MS);
    await expect(third).resolves.toBe('timedOut');
  });

  it('wake every open stream with reason reconnect when the listener listens again', async () => {
    const waiting = [streamOf().next(KEEP_ALIVE_MS, open()), streamOf({ ...scout, shipId: newId('ship'), type: 'builder' }).next(KEEP_ALIVE_MS, open())];

    hub.wakeAll();

    await expect(Promise.all(waiting)).resolves.toEqual(['reconnect', 'reconnect']);
  });

  it('end a wait for a keep-alive once its time passed, and not before', async () => {
    const outcomes: string[] = [];
    void streamOf()
      .next(KEEP_ALIVE_MS, open())
      .then((outcome) => outcomes.push(outcome));

    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_MS - 1);
    expect(outcomes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(outcomes).toEqual(['timedOut']);
  });

  it('end the wait of a stream its crew closed', async () => {
    const closing = new AbortController();
    const waiting = streamOf().next(KEEP_ALIVE_MS, closing.signal);

    closing.abort();

    await expect(waiting).resolves.toBe('ended');
  });

  it('forget a stream once it stops', async () => {
    const stream = streamOf();
    stream.stop();
    hub.deliveryPending(pendingFor({ kind: 'ship', shipId: scoutId }));

    const waiting = stream.next(1_000, open());
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(waiting).resolves.toBe('timedOut');
  });

  it('end every stream when the server stops, and open none after', async () => {
    const waiting = streamOf().next(KEEP_ALIVE_MS, open());

    hub.endAll();

    await expect(waiting).resolves.toBe('ended');
    expect(hub.open(scout)).toBeUndefined();
  });
});
