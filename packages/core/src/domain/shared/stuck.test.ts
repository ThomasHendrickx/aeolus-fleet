import { createIdGenerator, type DeliveryState, type LeaseId, type ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import type { Recipient } from './selector.js';
import { stuckAt, stuckPerHour, stuckPlaces, type DeliveryRecord, type FleetRecords, type LeaseRecord, type ShipRecord } from './stuck.js';

const newId = createIdGenerator();
const NOW = new Date('2026-10-16T12:00:00.000Z');
const WEEK_AGO = new Date('2026-10-09T12:00:00.000Z');
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE_MS);
}

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR_MS);
}

function aShip(overrides: Partial<ShipRecord> = {}): ShipRecord {
  return { shipId: newId('ship'), name: 'scout', type: 'reviewer', isAlwaysCrewed: false, isPerson: false, commissionedAt: WEEK_AGO, retiredAt: null, ...overrides };
}

function aLease(ship: ShipRecord, overrides: Partial<LeaseRecord> = {}): LeaseRecord {
  return { leaseId: newId('lease'), shipId: ship.shipId, startedAt: WEEK_AGO, endedAt: null, pushedAt: null, lastSeenAt: NOW, turns: [], ...overrides };
}

function aDelivery(recipient: Recipient, overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return { deliveryId: newId('delivery'), messageId: newId('message'), senderId: newId('ship'), recipient, claimedBy: null, reachableShipIds: [], sentAt: hoursAgo(2), steps: [], ...overrides };
}

function toShip(ship: ShipRecord): Recipient {
  return { kind: 'ship', shipId: ship.shipId };
}

function toType(type: string): Recipient {
  return { kind: 'type', type };
}

function aStep(state: DeliveryState, step: { at: Date; by?: { shipId: ShipId; leaseId: LeaseId } }) {
  return { state, at: step.at, shipId: step.by?.shipId ?? null, leaseId: step.by?.leaseId ?? null };
}

function records(parts: Partial<FleetRecords>): FleetRecords {
  return { ships: [], leases: [], deliveries: [], ...parts };
}

describe('a stuck delivery', () => {
  describe('undeliverable', () => {
    it('is stuck at the ship whose attempt made it so, since then', () => {
      const scout = aShip();
      const lease = aLease(scout);
      const delivery = aDelivery(toType('reviewer'), { steps: [aStep('undeliverable', { at: hoursAgo(21), by: lease })] });

      expect(stuckAt(records({ ships: [scout], leases: [lease], deliveries: [delivery] }), NOW)).toEqual([
        { deliveryId: delivery.deliveryId, messageId: delivery.messageId, state: 'undeliverable', cause: 'undeliverable', place: { kind: 'ship', shipId: scout.shipId }, since: hoursAgo(21) },
      ]);
    });

    it('is stuck at its type when no ship made the attempt', () => {
      const delivery = aDelivery(toType('reviewer'), { steps: [aStep('undeliverable', { at: hoursAgo(21) })] });

      expect(stuckAt(records({ deliveries: [delivery] }), NOW)).toMatchObject([{ cause: 'undeliverable', place: { kind: 'type', type: 'reviewer' } }]);
    });

    it('is no longer stuck once dismissed', () => {
      const delivery = aDelivery(toType('reviewer'), { steps: [aStep('undeliverable', { at: hoursAgo(21) }), aStep('dismissed', { at: hoursAgo(1) })] });

      expect(stuckAt(records({ deliveries: [delivery] }), NOW)).toEqual([]);
    });
  });

  describe('no ship can take it', () => {
    it('is pending to a type whose last ship retired, stuck at the type since it was sent', () => {
      const mapper = aShip({ type: 'mapper', retiredAt: hoursAgo(3) });
      const delivery = aDelivery(toType('mapper'), { sentAt: hoursAgo(5) });

      expect(stuckAt(records({ ships: [mapper], deliveries: [delivery] }), NOW)).toEqual([
        { deliveryId: delivery.deliveryId, messageId: delivery.messageId, state: 'pending', cause: 'noShipCanTake', place: { kind: 'type', type: 'mapper' }, since: hoursAgo(5) },
      ]);
    });

    it('is pending to a type whose reachable ships all retired, though another of the type is active', () => {
      const reachable = aShip({ retiredAt: hoursAgo(1) });
      const other = aShip();
      const delivery = aDelivery(toType('reviewer'), { reachableShipIds: [reachable.shipId] });

      expect(stuckAt(records({ ships: [reachable, other], leases: [aLease(other)], deliveries: [delivery] }), NOW)).toMatchObject([{ cause: 'noShipCanTake' }]);
    });

    it('is not stuck while a crewed ship of the type may take it', () => {
      const scout = aShip();

      expect(stuckAt(records({ ships: [scout], leases: [aLease(scout)], deliveries: [aDelivery(toType('reviewer'))] }), NOW)).toEqual([]);
    });

    it('waits since its latest return, not since it was sent', () => {
      const delivery = aDelivery(toType('mapper'), { sentAt: hoursAgo(9), steps: [aStep('handed', { at: hoursAgo(8) }), aStep('pending', { at: hoursAgo(4) })] });

      expect(stuckAt(records({ deliveries: [delivery] }), NOW)).toMatchObject([{ cause: 'noShipCanTake', since: hoursAgo(4) }]);
    });
  });

  describe('waiting for crew', () => {
    it('is pending to a ship awaiting crew, stuck at that ship since it was sent', () => {
      const docsWriter = aShip({ name: 'docs-writer', type: 'writer' });
      const delivery = aDelivery(toShip(docsWriter), { sentAt: hoursAgo(33) });

      expect(stuckAt(records({ ships: [docsWriter], deliveries: [delivery] }), NOW)).toEqual([
        { deliveryId: delivery.deliveryId, messageId: delivery.messageId, state: 'pending', cause: 'waitingForCrew', place: { kind: 'ship', shipId: docsWriter.shipId }, since: hoursAgo(33) },
      ]);
    });

    it('is pending to a type whose every ship that may take it awaits crew, stuck at the type', () => {
      const first = aShip();
      const second = aShip({ name: 'lookout' });

      expect(stuckAt(records({ ships: [first, second], deliveries: [aDelivery(toType('reviewer'))] }), NOW)).toMatchObject([
        { cause: 'waitingForCrew', place: { kind: 'type', type: 'reviewer' } },
      ]);
    });

    it('is not stuck when one ship of the type is crewed', () => {
      const first = aShip();
      const second = aShip({ name: 'lookout' });

      expect(stuckAt(records({ ships: [first, second], leases: [aLease(second)], deliveries: [aDelivery(toType('reviewer'))] }), NOW)).toEqual([]);
    });

    it('is never stuck pending to a person ship awaiting crew: the person is away (decision 0044)', () => {
      const thomas = aShip({ name: 'thomas', type: 'person', isPerson: true });

      expect(stuckAt(records({ ships: [thomas], deliveries: [aDelivery(toShip(thomas), { sentAt: hoursAgo(33) })] }), NOW)).toEqual([]);
    });

    it('is not stuck pending to a type whose ships await crew when one of them is a person ship', () => {
      const scout = aShip();
      const thomas = aShip({ name: 'thomas', isPerson: true });

      expect(stuckAt(records({ ships: [scout, thomas], deliveries: [aDelivery(toType('reviewer'))] }), NOW)).toEqual([]);
    });

    it('is never pending to argo, which is always crewed', () => {
      const argo = aShip({ name: 'argo', type: 'operator', isAlwaysCrewed: true });

      expect(stuckAt(records({ ships: [argo], deliveries: [aDelivery(toShip(argo))] }), NOW)).toEqual([]);
    });

    it('is not stuck once its ship is crewed, though its lease ended before', () => {
      const scout = aShip();
      const ended = aLease(scout, { startedAt: hoursAgo(10), endedAt: hoursAgo(9) });
      const open = aLease(scout, { startedAt: hoursAgo(1) });

      expect(stuckAt(records({ ships: [scout], leases: [ended, open], deliveries: [aDelivery(toShip(scout))] }), NOW)).toEqual([]);
    });
  });

  describe('stalled in flight on a plain lease', () => {
    it('is handed, its session last seen at the hand-over 10 minutes ago, stuck at the ship since the hand-over', () => {
      const scout = aShip();
      const lease = aLease(scout, { lastSeenAt: minutesAgo(10) });
      const delivery = aDelivery(toShip(scout), { steps: [aStep('handed', { at: minutesAgo(10), by: lease })] });

      expect(stuckAt(records({ ships: [scout], leases: [lease], deliveries: [delivery] }), NOW)).toEqual([
        { deliveryId: delivery.deliveryId, messageId: delivery.messageId, state: 'handed', cause: 'stalledInFlight', place: { kind: 'ship', shipId: scout.shipId }, since: minutesAgo(10) },
      ]);
    });

    it('is not stuck a moment before the 10 minutes are up', () => {
      const scout = aShip();
      const handedAt = new Date(NOW.getTime() - 10 * MINUTE_MS + 1);
      const lease = aLease(scout, { lastSeenAt: handedAt });
      const delivery = aDelivery(toShip(scout), { steps: [aStep('handed', { at: handedAt, by: lease })] });

      expect(stuckAt(records({ ships: [scout], leases: [lease], deliveries: [delivery] }), NOW)).toEqual([]);
    });

    it('is not stuck when its session was seen after the hand-over', () => {
      const scout = aShip();
      const lease = aLease(scout, { lastSeenAt: minutesAgo(30) });
      const delivery = aDelivery(toShip(scout), { steps: [aStep('handed', { at: minutesAgo(40), by: lease })] });

      expect(stuckAt(records({ ships: [scout], leases: [lease], deliveries: [delivery] }), NOW)).toEqual([]);
    });
  });

  describe('stalled in flight on a pushed lease', () => {
    function pushedScout(turns: LeaseRecord['turns'] = []) {
      const scout = aShip();
      const lease = aLease(scout, { pushedAt: hoursAgo(5), turns });
      return { scout, lease };
    }

    it('is handed and not confirmed for 10 minutes', () => {
      const { scout, lease } = pushedScout([{ state: 'busy', at: minutesAgo(30) }]);
      const delivery = aDelivery(toShip(scout), { steps: [aStep('received', { at: minutesAgo(20), by: lease }), aStep('handed', { at: minutesAgo(10), by: lease })] });

      expect(stuckAt(records({ ships: [scout], leases: [lease], deliveries: [delivery] }), NOW)).toMatchObject([
        { cause: 'stalledInFlight', place: { kind: 'ship', shipId: scout.shipId }, since: minutesAgo(10) },
      ]);
    });

    it('is received for 10 minutes while the session is idle', () => {
      const { scout, lease } = pushedScout([{ state: 'idle', at: minutesAgo(30) }]);
      const delivery = aDelivery(toShip(scout), { steps: [aStep('received', { at: minutesAgo(10), by: lease })] });

      expect(stuckAt(records({ ships: [scout], leases: [lease], deliveries: [delivery] }), NOW)).toMatchObject([{ cause: 'stalledInFlight' }]);
    });

    it('is not stuck received for 59 minutes while the session is busy, and is at 60', () => {
      const { scout, lease } = pushedScout([{ state: 'busy', at: hoursAgo(2) }]);
      const fresh = aDelivery(toShip(scout), { steps: [aStep('received', { at: minutesAgo(59), by: lease })] });
      const old = aDelivery(toShip(scout), { steps: [aStep('received', { at: minutesAgo(60), by: lease })] });

      expect(stuckAt(records({ ships: [scout], leases: [lease], deliveries: [fresh, old] }), NOW)).toMatchObject([{ deliveryId: old.deliveryId }]);
    });

    it('counts every delivery whose clock ran out, not only the oldest', () => {
      const { scout, lease } = pushedScout();
      const first = aDelivery(toShip(scout), { sentAt: minutesAgo(40) });
      const second = aDelivery(toShip(scout), { sentAt: minutesAgo(39) });

      expect(stuckAt(records({ ships: [scout], leases: [lease], deliveries: [first, second] }), NOW)).toMatchObject([
        { deliveryId: first.deliveryId, cause: 'stalledInFlight', place: { kind: 'ship', shipId: scout.shipId } },
        { deliveryId: second.deliveryId, cause: 'stalledInFlight', place: { kind: 'ship', shipId: scout.shipId } },
      ]);
    });

    it('is never stalled at a person ship, handed and not opened for hours or waiting pending: a person away is not stuck (interop 5.1)', () => {
      const thomas = aShip({ name: 'thomas', type: 'person', isPerson: true });
      const lease = aLease(thomas, { pushedAt: hoursAgo(5) });
      const handed = aDelivery(toShip(thomas), { steps: [aStep('received', { at: hoursAgo(4), by: lease }), aStep('handed', { at: hoursAgo(3), by: lease })] });
      const pending = aDelivery(toShip(thomas), { sentAt: hoursAgo(2) });

      expect(stuckAt(records({ ships: [thomas], leases: [lease], deliveries: [handed, pending] }), NOW)).toEqual([]);
    });

    it('is never stalled at a person ship on a plain lease, its app not seen since the hand-over', () => {
      const thomas = aShip({ name: 'thomas', type: 'person', isPerson: true });
      const lease = aLease(thomas, { lastSeenAt: hoursAgo(3) });
      const handed = aDelivery(toShip(thomas), { steps: [aStep('handed', { at: hoursAgo(3), by: lease })] });

      expect(stuckAt(records({ ships: [thomas], leases: [lease], deliveries: [handed] }), NOW)).toEqual([]);
    });

    it('is pending to a type for 10 minutes while its pushed ship is idle', () => {
      const { scout, lease } = pushedScout();

      expect(stuckAt(records({ ships: [scout], leases: [lease], deliveries: [aDelivery(toType('reviewer'), { sentAt: minutesAgo(10) })] }), NOW)).toMatchObject([
        { cause: 'stalledInFlight', place: { kind: 'ship', shipId: scout.shipId } },
      ]);
    });
  });

  it('is never acknowledged, handled or not handled', () => {
    const scout = aShip();
    const lease = aLease(scout, { lastSeenAt: hoursAgo(5) });
    const states: DeliveryState[] = ['acknowledged', 'handled', 'notHandled'];
    const deliveries = states.map((state) => aDelivery(toShip(scout), { steps: [aStep('handed', { at: hoursAgo(5), by: lease }), aStep(state, { at: hoursAgo(4), by: lease })] }));

    expect(stuckAt(records({ ships: [scout], leases: [lease], deliveries }), NOW)).toEqual([]);
  });

  it('is not counted before it was sent', () => {
    const delivery = aDelivery(toType('mapper'), { sentAt: hoursAgo(1) });

    expect(stuckAt(records({ deliveries: [delivery] }), hoursAgo(2))).toEqual([]);
  });
});

describe('stuck deliveries at an earlier time', () => {
  it('reads the ships, leases and states as they were then', () => {
    const mapper = aShip({ type: 'mapper', retiredAt: hoursAgo(20), commissionedAt: WEEK_AGO });
    const newMapper = aShip({ type: 'mapper', commissionedAt: hoursAgo(5) });
    const delivery = aDelivery(toType('mapper'), { sentAt: hoursAgo(30) });
    const fleet = records({ ships: [mapper, newMapper], leases: [aLease(mapper, { endedAt: hoursAgo(20) }), aLease(newMapper, { startedAt: hoursAgo(5) })], deliveries: [delivery] });

    expect([hoursAgo(25), hoursAgo(10), hoursAgo(1)].map((at) => stuckAt(fleet, at).map((stuck) => stuck.cause))).toEqual([[], ['noShipCanTake'], []]);
  });

  it('counts a plain stall from 10 minutes after the hand-over until it left handed', () => {
    const scout = aShip();
    const lease = aLease(scout, { lastSeenAt: hoursAgo(10) });
    const delivery = aDelivery(toShip(scout), { sentAt: hoursAgo(11), steps: [aStep('handed', { at: hoursAgo(10), by: lease }), aStep('acknowledged', { at: hoursAgo(2), by: lease })] });
    const fleet = records({ ships: [scout], leases: [lease], deliveries: [delivery] });

    expect([hoursAgo(10), hoursAgo(9), hoursAgo(1)].map((at) => stuckAt(fleet, at).length)).toEqual([0, 1, 0]);
  });

  it('reads the turn a pushed session had then', () => {
    const scout = aShip();
    const lease = aLease(scout, { pushedAt: hoursAgo(5), turns: [{ state: 'busy', at: hoursAgo(4) }, { state: 'idle', at: minutesAgo(30) }] });
    const delivery = aDelivery(toShip(scout), { sentAt: hoursAgo(4.5), steps: [aStep('received', { at: hoursAgo(4), by: lease })] });
    const fleet = records({ ships: [scout], leases: [lease], deliveries: [delivery] });

    expect([hoursAgo(3.5), minutesAgo(25), minutesAgo(20)].map((at) => stuckAt(fleet, at).length)).toEqual([0, 0, 1]);
  });
});

describe('stuck deliveries per hour', () => {
  it('counts the stuck deliveries at each hour of the last 7 days, the last one now', () => {
    const delivery = aDelivery(toType('mapper'), { sentAt: new Date(NOW.getTime() - 2 * HOUR_MS - 1) });

    const perHour = stuckPerHour(records({ deliveries: [delivery] }), NOW);

    expect(perHour).toHaveLength(168);
    expect(perHour[0]).toEqual({ at: hoursAgo(167), count: 0 });
    expect(perHour.slice(-4)).toEqual([
      { at: hoursAgo(3), count: 0 },
      { at: hoursAgo(2), count: 1 },
      { at: hoursAgo(1), count: 1 },
      { at: NOW, count: 1 },
    ]);
  });
});

describe('the places deliveries are stuck in', () => {
  it('groups them by cause and place, with their count, oldest since and each delivery, oldest first', () => {
    const scout = aShip();
    const scoutPlace = { kind: 'ship' as const, shipId: scout.shipId };
    const mapperPlace = { kind: 'type' as const, type: 'mapper' };
    const [first, second, third, fourth] = [newId('delivery'), newId('delivery'), newId('delivery'), newId('delivery')];
    const messageId = newId('message');

    expect(
      stuckPlaces([
        { deliveryId: first, messageId, state: 'pending', cause: 'waitingForCrew', place: scoutPlace, since: hoursAgo(2) },
        { deliveryId: second, messageId, state: 'pending', cause: 'noShipCanTake', place: mapperPlace, since: hoursAgo(1) },
        { deliveryId: third, messageId, state: 'pending', cause: 'waitingForCrew', place: scoutPlace, since: hoursAgo(3) },
        { deliveryId: fourth, messageId, state: 'undeliverable', cause: 'undeliverable', place: scoutPlace, since: hoursAgo(5) },
      ]),
    ).toEqual([
      { cause: 'undeliverable', place: scoutPlace, count: 1, oldestSince: hoursAgo(5), deliveries: [{ deliveryId: fourth, messageId, state: 'undeliverable', since: hoursAgo(5) }] },
      {
        cause: 'waitingForCrew',
        place: scoutPlace,
        count: 2,
        oldestSince: hoursAgo(3),
        deliveries: [
          { deliveryId: third, messageId, state: 'pending', since: hoursAgo(3) },
          { deliveryId: first, messageId, state: 'pending', since: hoursAgo(2) },
        ],
      },
      { cause: 'noShipCanTake', place: mapperPlace, count: 1, oldestSince: hoursAgo(1), deliveries: [{ deliveryId: second, messageId, state: 'pending', since: hoursAgo(1) }] },
    ]);
  });
});
