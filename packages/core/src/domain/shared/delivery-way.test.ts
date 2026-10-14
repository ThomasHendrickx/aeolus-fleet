import { createIdGenerator, type DeliveryState } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { computerSideOf, deliveryWayOf, type WayLease } from './delivery-way.js';
import type { DeliveryChange } from './history.js';

const newId = createIdGenerator();
const scout = { id: newId('ship'), name: 'scout' };
const macMini = { id: newId('ship'), name: 'mac-mini' };
const STORED_AT = new Date('2026-10-14T09:00:00.000Z');

function aLease(overrides: Partial<WayLease> = {}): WayLease {
  return {
    location: { kind: 'DEVICE', description: null },
    harness: 'claude-code',
    trierarch: null,
    isPushed: true,
    isEnded: false,
    endReason: null,
    turn: null,
    ...overrides,
  };
}

function aStep(overrides: Partial<DeliveryChange> & Pick<DeliveryChange, 'type'>): DeliveryChange {
  return {
    seq: 1,
    occurredAt: STORED_AT,
    ship: scout,
    location: null,
    harness: null,
    attempts: null,
    by: null,
    handOverNumber: null,
    isAgain: false,
    isOnceMore: false,
    overdue: null,
    leaseEnd: null,
    ...overrides,
  };
}

/** A minute after the store, each step a minute later than the one before. */
function minutesAfterStore(minutes: number): Date {
  return new Date(STORED_AT.getTime() + minutes * 60_000);
}

function wayOf(state: DeliveryState, read: { history?: DeliveryChange[]; lease?: WayLease | null } = {}) {
  return deliveryWayOf({
    state,
    history: read.history ?? [aStep({ type: 'MessageAccepted', ship: null })],
    lease: read.lease ?? null,
    overdue: null,
    crew: null,
  });
}

describe('the computer side of a lease', () => {
  it('is the trierarch whose starting prompt its crew claimed with', () => {
    expect(computerSideOf(aLease({ trierarch: macMini }))).toEqual({ kind: 'trierarch', trierarch: macMini });
  });

  it('is the plugin watcher on a session crewed by hand', () => {
    expect(computerSideOf(aLease())).toEqual({ kind: 'pluginWatcher' });
  });

  it('is none on a pull lease, which its agent receives on itself', () => {
    expect(computerSideOf(aLease({ isPushed: false, trierarch: macMini }))).toBeNull();
  });
});

describe('who holds a delivery', () => {
  it('is the fleet while it is pending', () => {
    expect(wayOf('pending').holder).toEqual({ kind: 'fleet' });
  });

  it('is the trierarch that received it on its computer', () => {
    expect(wayOf('received', { lease: aLease({ trierarch: macMini }) }).holder).toEqual({ kind: 'trierarch', trierarch: macMini });
  });

  it('is the plugin watcher that received it for a session crewed by hand', () => {
    expect(wayOf('received', { lease: aLease() }).holder).toEqual({ kind: 'pluginWatcher' });
  });

  it.each<DeliveryState>(['handed', 'acknowledged'])('is the agent once it is %s', (state) => {
    expect(wayOf(state, { lease: aLease() }).holder).toEqual({ kind: 'agent' });
  });

  it.each<DeliveryState>(['handled', 'notHandled', 'undeliverable', 'dismissed', 'abandoned'])('is nobody once it is %s', (state) => {
    expect(wayOf(state, { lease: aLease() }).holder).toBeNull();
  });
});

describe('since when a delivery is in its state', () => {
  it('is its newest step', () => {
    const history = [
      aStep({ type: 'DeliveryHanded', occurredAt: minutesAfterStore(2), handOverNumber: 1 }),
      aStep({ type: 'DeliveryReceived', occurredAt: minutesAfterStore(1) }),
      aStep({ type: 'MessageAccepted', ship: null }),
    ];

    expect(wayOf('handed', { history }).since).toEqual(minutesAfterStore(2));
  });

  it('skips the overdue clock, a receive again and a hand-over once more, which change no state', () => {
    const history = [
      aStep({ type: 'DeliveryOverdue', occurredAt: minutesAfterStore(13), overdue: { clock: 'busy', minutes: 60 } }),
      aStep({ type: 'DeliveryHanded', occurredAt: minutesAfterStore(12), handOverNumber: 2, isOnceMore: true }),
      aStep({ type: 'DeliveryReceived', occurredAt: minutesAfterStore(11), isAgain: true }),
      aStep({ type: 'DeliveryAcknowledged', occurredAt: minutesAfterStore(3) }),
      aStep({ type: 'MessageAccepted', ship: null }),
    ];

    expect(wayOf('acknowledged', { history }).since).toEqual(minutesAfterStore(3));
  });
});

describe('whether a delivery was pulled', () => {
  it('is pulled when a plain receive handed it last, with no hand-over number', () => {
    const history = [aStep({ type: 'DeliveryAcknowledged' }), aStep({ type: 'DeliveryHanded', attempts: 1 }), aStep({ type: 'MessageAccepted', ship: null })];

    expect(wayOf('acknowledged', { history }).isPulled).toBe(true);
  });

  it('is not pulled when its computer side handed it with a number', () => {
    const history = [aStep({ type: 'DeliveryHanded', handOverNumber: 1 }), aStep({ type: 'MessageAccepted', ship: null })];

    expect(wayOf('handed', { history }).isPulled).toBe(false);
  });

  it('is not pulled before anyone handed it', () => {
    expect(wayOf('pending').isPulled).toBe(false);
  });
});

describe('the way of a delivery', () => {
  it('keeps the overdue clock that stands, the lease and the crew its trierarch runs', () => {
    const lease = aLease({ trierarch: macMini, turn: { state: 'busy', at: minutesAfterStore(1) } });
    const overdue = { clock: 'busy' as const, minutes: 60, toldAt: minutesAfterStore(61) };
    const crew = { status: 'restarting' as const, attempt: 2, startedAt: null };

    expect(deliveryWayOf({ state: 'received', history: [aStep({ type: 'MessageAccepted', ship: null })], lease, overdue, crew })).toMatchObject({
      overdue,
      lease: { by: { kind: 'trierarch', trierarch: macMini }, isEnded: false, turn: { state: 'busy', at: minutesAfterStore(1) } },
      crew,
    });
  });
});
