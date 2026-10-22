import { createIdGenerator, type DeliveryId, type EventType, type LeaseId, type ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import type { EventDetails, SequencedEvent } from './events.js';
import { closeHour, healthFromSnapshot, hourSnapshotOf, type HealthCrews, type HourSnapshot, type LatestSnapshot } from './health-snapshot.js';
import type { DeliveryRecord, FleetRecords, LeaseRecord, ShipRecord } from './stuck.js';

const newId = createIdGenerator();
const HOUR = new Date('2026-10-16T12:00:00.000Z');
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function minutesAfter(minutes: number): Date {
  return new Date(HOUR.getTime() + minutes * MINUTE_MS);
}

function hoursAfter(hours: number): Date {
  return new Date(HOUR.getTime() + hours * HOUR_MS);
}

const scout: ShipRecord = { shipId: newId('ship'), name: 'scout', type: 'scout', isAlwaysCrewed: false, isPerson: false, commissionedAt: hoursAfter(-500), retiredAt: null };
const planner: ShipRecord = { shipId: newId('ship'), name: 'planner', type: 'planner', isAlwaysCrewed: false, isPerson: false, commissionedAt: hoursAfter(-500), retiredAt: null };
const mapper: ShipRecord = { shipId: newId('ship'), name: 'mapper', type: 'mapper', isAlwaysCrewed: false, isPerson: false, commissionedAt: hoursAfter(-500), retiredAt: hoursAfter(-300) };

function aLease(ship: ShipRecord, overrides: Partial<LeaseRecord> = {}): LeaseRecord {
  return { leaseId: newId('lease'), shipId: ship.shipId, startedAt: hoursAfter(-400), endedAt: null, pushedAt: null, lastSeenAt: hoursAfter(-400), turns: [], ...overrides };
}

function aDelivery(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    deliveryId: newId('delivery'),
    messageId: newId('message'),
    senderId: scout.shipId,
    recipient: { kind: 'type', type: 'mapper' },
    claimedBy: null,
    reachableShipIds: [],
    sentAt: minutesAfter(-90),
    steps: [],
    ...overrides,
  };
}

let seq = 10;

function anEvent(type: EventType, about: { at: Date; deliveryId?: DeliveryId; shipId?: ShipId; leaseId?: LeaseId; details?: EventDetails }): SequencedEvent {
  seq += 1;
  return {
    id: newId('event'),
    fleetId: newId('fleet'),
    type,
    occurredAt: about.at,
    actor: { kind: 'system' },
    ...(about.deliveryId && { deliveryId: about.deliveryId }),
    ...(about.shipId && { shipId: about.shipId }),
    details: { ...(about.leaseId && { leaseId: about.leaseId }), ...about.details },
    seq,
  };
}

function crewsOf(parts: Partial<HealthCrews> = {}): HealthCrews {
  return { ships: [scout, planner, mapper], leases: [], machines: [], ...parts };
}

function aLatest(parts: Partial<LatestSnapshot['fold']> = {}, hour = HOUR): LatestSnapshot {
  return { hour, fold: { seq: 10, deliveries: [], turns: [], ...parts } };
}

const everything = { reads: () => true, readsShip: () => true };

function countOf(hour: HourSnapshot): number {
  return hour.stuck.reduce((sum, counted) => sum + counted.count, 0);
}

describe('an hour of the stuck snapshot', () => {
  it('counts the deliveries stuck at the hour by cause, place and message, with the oldest since', () => {
    const older = aDelivery({ sentAt: minutesAfter(-90) });
    const newer = aDelivery({ sentAt: minutesAfter(-30) });
    const fromPlanner = aDelivery({ senderId: planner.shipId, sentAt: minutesAfter(-10) });
    const records: FleetRecords = { ships: [scout, planner, mapper], leases: [], deliveries: [older, newer, fromPlanner] };

    const hour = hourSnapshotOf(records, { hour: HOUR, acknowledged: [] });

    expect(hour).toEqual({
      hour: HOUR,
      stuck: [
        { cause: 'noShipCanTake', place: { kind: 'type', type: 'mapper' }, message: { senderId: scout.shipId, recipient: { kind: 'type', type: 'mapper' }, claimedBy: null }, count: 2, oldestSince: minutesAfter(-90) },
        { cause: 'noShipCanTake', place: { kind: 'type', type: 'mapper' }, message: { senderId: planner.shipId, recipient: { kind: 'type', type: 'mapper' }, claimedBy: null }, count: 1, oldestSince: minutesAfter(-10) },
      ],
      acknowledged: [],
    });
  });

  it('keeps the acknowledged waits by message', () => {
    const message = { senderId: scout.shipId, recipient: { kind: 'type' as const, type: 'planner' }, claimedBy: planner.shipId };

    const hour = hourSnapshotOf(
      { ships: [], leases: [], deliveries: [] },
      {
        hour: HOUR,
        acknowledged: [
          { sentAt: minutesAfter(-10), acknowledgedAt: minutesAfter(-5), message },
          { sentAt: minutesAfter(-10), acknowledgedAt: minutesAfter(-9), message },
        ],
      },
    );

    expect(hour.acknowledged).toHaveLength(1);
    expect(hour.acknowledged[0]?.message).toEqual(message);
    expect([...(hour.acknowledged[0]?.waits.values() ?? [])].reduce((sum, count) => sum + count, 0)).toBe(2);
  });
});

describe('closing the next hour', () => {
  it('folds the events up to the next hour mark and counts what is stuck at it', () => {
    const toMapper = aDelivery({ sentAt: minutesAfter(30) });
    const accepted = anEvent('MessageAccepted', { at: minutesAfter(30), deliveryId: toMapper.deliveryId });
    const pastTheMark = anEvent('DeliveryDismissed', { at: minutesAfter(61), deliveryId: toMapper.deliveryId });

    const closed = closeHour(aLatest(), { events: [accepted, pastTheMark], sent: [toMapper], crews: crewsOf() });

    expect(closed.hour).toMatchObject({ hour: hoursAfter(1), stuck: [{ cause: 'noShipCanTake', count: 1 }] });
    expect(closed.fold).toMatchObject({ seq: accepted.seq, deliveries: [{ deliveryId: toMapper.deliveryId }] });
  });

  it('reads a pushed lease at the turn folded by the mark', () => {
    const lease = aLease(planner, { pushedAt: hoursAfter(-10) });
    const toPlanner = aDelivery({ recipient: { kind: 'type', type: 'planner' }, sentAt: minutesAfter(-20) });
    const busy = anEvent('TurnReported', { at: minutesAfter(10), leaseId: lease.leaseId, details: { turn: 'busy' } });

    const closed = closeHour(aLatest({ deliveries: [toPlanner], turns: [{ leaseId: lease.leaseId, turn: { state: 'idle', at: hoursAfter(-10) } }] }), {
      events: [busy],
      sent: [],
      crews: crewsOf({ leases: [lease] }),
    });

    // Busy for 50 minutes at the mark: its 60 minute clock runs. Still idle, its 10 minute clock would have run out.
    expect(countOf(closed.hour)).toBe(0);
  });
});

describe('the health read from the snapshot', () => {
  it('folds the events after the snapshot for what is stuck now', () => {
    const toMapper = aDelivery({ sentAt: minutesAfter(10) });

    const health = healthFromSnapshot(
      { latest: aLatest(), hours: [], events: [anEvent('MessageAccepted', { at: minutesAfter(10), deliveryId: toMapper.deliveryId })], sent: [toMapper], crews: crewsOf() },
      { now: minutesAfter(20), ...everything },
    );

    expect(health.stuck).toMatchObject([{ cause: 'noShipCanTake', place: { kind: 'type', type: 'mapper' }, count: 1, oldestSince: minutesAfter(10) }]);
  });

  it('answers 168 hours: the closed hours, none where no hour was kept, and stuck now last', () => {
    const stuckOne = aDelivery({ sentAt: hoursAfter(-3) });
    const kept = hourSnapshotOf({ ships: [scout, planner, mapper], leases: [], deliveries: [stuckOne] }, { hour: HOUR, acknowledged: [] });

    const health = healthFromSnapshot({ latest: aLatest({ deliveries: [stuckOne] }), hours: [kept], events: [], sent: [], crews: crewsOf() }, { now: minutesAfter(20), ...everything });

    expect(health.stuckPerHour).toHaveLength(168);
    expect(health.stuckPerHour.at(-2)).toEqual({ at: HOUR, count: 1 });
    expect(health.stuckPerHour.at(-3)).toEqual({ at: hoursAfter(-1), count: 0 });
    expect(health.stuckPerHour.at(-1)).toEqual({ at: minutesAfter(20), count: 1 });
  });

  it('counts only the deliveries whose message the caller reads, in every hour and now', () => {
    const fromPlanner = aDelivery({ senderId: planner.shipId, sentAt: hoursAfter(-3) });
    const fromScout = aDelivery({ sentAt: hoursAfter(-3) });
    const kept = hourSnapshotOf({ ships: [scout, planner, mapper], leases: [], deliveries: [fromPlanner, fromScout] }, { hour: HOUR, acknowledged: [] });

    const health = healthFromSnapshot(
      { latest: aLatest({ deliveries: [fromPlanner, fromScout] }), hours: [kept], events: [], sent: [], crews: crewsOf() },
      { now: minutesAfter(20), reads: (message) => message.senderId === scout.shipId, readsShip: () => true },
    );

    expect(health.stuckPerHour.at(-2)?.count).toBe(1);
    expect(health.stuck).toMatchObject([{ count: 1, deliveries: [{ deliveryId: fromScout.deliveryId }] }]);
  });

  it('folds the hours a snapshot behind has not closed', () => {
    const toMapper = aDelivery({ sentAt: minutesAfter(30) });

    const health = healthFromSnapshot(
      { latest: aLatest(), hours: [], events: [anEvent('MessageAccepted', { at: minutesAfter(30), deliveryId: toMapper.deliveryId })], sent: [toMapper], crews: crewsOf() },
      { now: hoursAfter(2.5), ...everything },
    );

    expect(health.stuckPerHour.slice(-4)).toEqual([
      { at: HOUR, count: 0 },
      { at: hoursAfter(1), count: 1 },
      { at: hoursAfter(2), count: 1 },
      { at: hoursAfter(2.5), count: 1 },
    ]);
  });

  it('counts the acknowledged of the 23 closed hours and the open one, with their median', () => {
    const message = { senderId: scout.shipId, recipient: { kind: 'type' as const, type: 'planner' }, claimedBy: planner.shipId };
    const kept = hourSnapshotOf({ ships: [], leases: [], deliveries: [] }, { hour: HOUR, acknowledged: [{ sentAt: minutesAfter(-10), acknowledgedAt: minutesAfter(-5), message }] });
    const longAgo = hourSnapshotOf({ ships: [], leases: [], deliveries: [] }, { hour: hoursAfter(-23), acknowledged: [{ sentAt: hoursAfter(-24), acknowledgedAt: hoursAfter(-23), message }] });
    const open = aDelivery({ recipient: message.recipient, sentAt: minutesAfter(10) });

    const health = healthFromSnapshot(
      {
        latest: aLatest({ deliveries: [open] }),
        hours: [longAgo, kept],
        events: [anEvent('DeliveryAcknowledged', { at: minutesAfter(13), deliveryId: open.deliveryId, shipId: planner.shipId })],
        sent: [],
        crews: crewsOf(),
      },
      { now: minutesAfter(20), ...everything },
    );

    expect(health.acknowledged.perHour).toHaveLength(24);
    expect(health.acknowledged.perHour.at(-1)).toEqual({ at: minutesAfter(20), count: 1 });
    expect(health.acknowledged.perHour.at(-2)).toEqual({ at: HOUR, count: 1 });
    expect(health.acknowledged.count).toBe(2);
    expect(health.acknowledged.medianMs).toBeGreaterThan(3.95 * MINUTE_MS);
    expect(health.acknowledged.medianMs).toBeLessThan(4.05 * MINUTE_MS);
  });
});
