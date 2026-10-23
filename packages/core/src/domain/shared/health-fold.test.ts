import { createIdGenerator, type DeliveryId, type EventType, type LeaseId, type ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import type { EventDetails, SequencedEvent } from './events.js';
import { foldAt, foldHealth, type HealthFold } from './health-fold.js';
import type { DeliveryRecord, FleetRecords } from './stuck.js';

const newId = createIdGenerator();
const HOUR = new Date('2026-10-16T12:00:00.000Z');
const MINUTE_MS = 60_000;

function minutesAfter(minutes: number): Date {
  return new Date(HOUR.getTime() + minutes * MINUTE_MS);
}

const scout = newId('ship');
const planner = newId('ship');
const plannerLease = newId('lease');

function aDelivery(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    deliveryId: newId('delivery'),
    messageId: newId('message'),
    senderId: scout,
    recipient: { kind: 'type', type: 'planner' },
    claimedBy: null,
    reachableShipIds: [],
    sentAt: minutesAfter(-90),
    steps: [],
    ...overrides,
  };
}

function aFold(parts: Partial<HealthFold> = {}): HealthFold {
  return { seq: 10, deliveries: [], turns: [], ...parts };
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

describe('folding events into the stuck snapshot', () => {
  it('adds a delivery sent after it, pending since its send', () => {
    const sent = aDelivery({ sentAt: minutesAfter(5) });

    const { fold } = foldHealth(aFold(), { events: [anEvent('MessageAccepted', { at: minutesAfter(5), deliveryId: sent.deliveryId })], sent: [sent] });

    expect(fold.deliveries).toEqual([sent]);
  });

  it('keeps a delivery at its latest step, claimed by the ship that received it', () => {
    const delivery = aDelivery();

    const { fold } = foldHealth(aFold({ deliveries: [delivery] }), {
      events: [anEvent('DeliveryReceived', { at: minutesAfter(5), deliveryId: delivery.deliveryId, shipId: planner, leaseId: plannerLease })],
      sent: [],
    });

    expect(fold.deliveries).toEqual([{ ...delivery, claimedBy: planner, steps: [{ state: 'received', at: minutesAfter(5), shipId: planner, leaseId: plannerLease }] }]);
  });

  it('clears the claim of a delivery returned to pending', () => {
    const delivery = aDelivery({ claimedBy: planner, steps: [{ state: 'received', at: minutesAfter(-30), shipId: planner, leaseId: plannerLease }] });

    const { fold } = foldHealth(aFold({ deliveries: [delivery] }), {
      events: [anEvent('DeliveryReturned', { at: minutesAfter(5), deliveryId: delivery.deliveryId, shipId: planner, leaseId: plannerLease })],
      sent: [],
    });

    expect(fold.deliveries).toMatchObject([{ claimedBy: null, steps: [{ state: 'pending', at: minutesAfter(5) }] }]);
  });

  it('lets an acknowledged delivery go and answers its wait from send', () => {
    const delivery = aDelivery({ sentAt: minutesAfter(-30) });

    const folded = foldHealth(aFold({ deliveries: [delivery] }), {
      events: [anEvent('DeliveryAcknowledged', { at: minutesAfter(5), deliveryId: delivery.deliveryId, shipId: planner, leaseId: plannerLease })],
      sent: [],
    });

    expect(folded.fold.deliveries).toEqual([]);
    expect(folded.acknowledged).toEqual([
      { sentAt: minutesAfter(-30), acknowledgedAt: minutesAfter(5), message: { senderId: scout, recipient: { kind: 'type', type: 'planner' }, claimedBy: null } },
    ]);
  });

  it('lets a dismissed delivery go', () => {
    const delivery = aDelivery({ steps: [{ state: 'undeliverable', at: minutesAfter(-30), shipId: null, leaseId: null }] });

    const { fold } = foldHealth(aFold({ deliveries: [delivery] }), { events: [anEvent('DeliveryDismissed', { at: minutesAfter(5), deliveryId: delivery.deliveryId })], sent: [] });

    expect(fold.deliveries).toEqual([]);
  });

  it('keeps the latest turn of each lease', () => {
    const { fold } = foldHealth(aFold({ turns: [{ leaseId: plannerLease, turn: { state: 'idle', at: minutesAfter(-30) } }] }), {
      events: [anEvent('TurnReported', { at: minutesAfter(5), leaseId: plannerLease, details: { turn: 'busy' } })],
      sent: [],
    });

    expect(fold.turns).toEqual([{ leaseId: plannerLease, turn: { state: 'busy', at: minutesAfter(5) } }]);
  });

  it('stops at the first event past the hour it folds to, at the last event it folded', () => {
    const delivery = aDelivery();
    const received = anEvent('DeliveryReceived', { at: minutesAfter(59), deliveryId: delivery.deliveryId, shipId: planner, leaseId: plannerLease });
    const acknowledged = anEvent('DeliveryAcknowledged', { at: minutesAfter(61), deliveryId: delivery.deliveryId, shipId: planner, leaseId: plannerLease });

    const { fold } = foldHealth(aFold({ deliveries: [delivery] }), { events: [received, acknowledged], sent: [], until: minutesAfter(60) });

    expect(fold).toMatchObject({ seq: received.seq, deliveries: [{ steps: [{ state: 'received' }] }] });
  });

  it('folds a late commit into the hour it lands in: an earlier time after a later one', () => {
    const delivery = aDelivery();
    const later = anEvent('MessageAccepted', { at: minutesAfter(61), deliveryId: newId('delivery') });
    const late = anEvent('DeliveryReceived', { at: minutesAfter(59), deliveryId: delivery.deliveryId, shipId: planner, leaseId: plannerLease });

    const { fold } = foldHealth(aFold({ deliveries: [delivery] }), { events: [later, late], sent: [], until: minutesAfter(60) });

    expect(fold).toMatchObject({ seq: 10, deliveries: [{ steps: [] }] });
  });

  it('passes over an event of a delivery it does not hold', () => {
    const { fold } = foldHealth(aFold(), { events: [anEvent('DeliveryAcknowledged', { at: minutesAfter(5), deliveryId: newId('delivery') })], sent: [] });

    expect(fold.deliveries).toEqual([]);
  });

  it('changes nothing for a step it already holds', () => {
    const step = { state: 'received' as const, at: minutesAfter(5), shipId: planner, leaseId: plannerLease };
    const delivery = aDelivery({ claimedBy: planner, steps: [step] });

    const { fold } = foldHealth(aFold({ deliveries: [delivery] }), {
      events: [anEvent('DeliveryReceived', { at: minutesAfter(5), deliveryId: delivery.deliveryId, shipId: planner, leaseId: plannerLease })],
      sent: [],
    });

    expect(fold.deliveries).toEqual([delivery]);
  });
});

describe('the stuck snapshot at an hour, from the fleet records', () => {
  it('keeps the deliveries open at the hour, each at its latest step by then, and each lease at its latest turn', () => {
    const open = aDelivery({ steps: [{ state: 'received', at: minutesAfter(-20), shipId: planner, leaseId: plannerLease }] });
    const acknowledgedLater = aDelivery({
      steps: [
        { state: 'received', at: minutesAfter(-10), shipId: planner, leaseId: plannerLease },
        { state: 'acknowledged', at: minutesAfter(10), shipId: planner, leaseId: plannerLease },
      ],
    });
    const acknowledgedBefore = aDelivery({ steps: [{ state: 'acknowledged', at: minutesAfter(-5), shipId: planner, leaseId: plannerLease }] });
    const sentLater = aDelivery({ sentAt: minutesAfter(10) });
    const records: FleetRecords = {
      ships: [],
      leases: [
        {
          leaseId: plannerLease,
          shipId: planner,
          startedAt: minutesAfter(-600),
          endedAt: null,
          pushedAt: minutesAfter(-600),
          lastSeenAt: HOUR,
          turns: [
            { state: 'busy', at: minutesAfter(-30) },
            { state: 'idle', at: minutesAfter(30) },
          ],
        },
      ],
      deliveries: [open, acknowledgedLater, acknowledgedBefore, sentLater],
    };

    expect(foldAt(records, { at: HOUR, seq: 42 })).toEqual({
      seq: 42,
      deliveries: [open, { ...acknowledgedLater, steps: [{ state: 'received', at: minutesAfter(-10), shipId: planner, leaseId: plannerLease }] }],
      turns: [{ leaseId: plannerLease, turn: { state: 'busy', at: minutesAfter(-30) } }],
    });
  });
});
