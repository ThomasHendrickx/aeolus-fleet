/**
 * The fold of the stuck snapshot (docs/design/performance/performance.md,
 * section 5): a snapshot keeps the fleet's open deliveries, each at its latest
 * step, and each lease's latest turn, as of the last event folded into it. The
 * rule of `stuck.ts` reads a delivery's state and a lease's turn at a time from
 * their latest step and turn by then, so what the fold keeps answers it alike
 * at any time from that event on. Events fold in their fleet's `seq` order.
 */
import { isId, turnStateSchema, type DeliveryId, type DeliveryState, type LeaseId } from '@aeolus-fleet/common';

import type { SequencedEvent } from './events.js';
import type { AcknowledgedDelivery } from './health.js';
import { stateStepOf, type DeliveryRecord, type DeliveryStep, type FleetRecords, type LeaseTurn } from './stuck.js';

/** A lease's latest turn. */
export interface LeaseTurnFact {
  leaseId: LeaseId;
  turn: LeaseTurn;
}

/** What a snapshot keeps for the fold: the last event folded into it, the open deliveries at their latest step, and each lease's latest turn. */
export interface HealthFold {
  seq: number;
  deliveries: readonly DeliveryRecord[];
  turns: readonly LeaseTurnFact[];
}

/** The fold after the events, and the deliveries acknowledged among them. */
export interface Folded {
  fold: HealthFold;
  acknowledged: AcknowledgedDelivery[];
}

/** The states a delivery is open in: the rule may count it stuck. */
const OPEN_STATES: ReadonlySet<DeliveryState> = new Set(['pending', 'received', 'handed', 'undeliverable']);

function isSameStep(first: DeliveryStep | undefined, second: DeliveryStep): boolean {
  return first?.state === second.state && first.at.getTime() === second.at.getTime() && first.leaseId === second.leaseId;
}

/** Who holds its claim after the step: the ship that received it or was handed it, none once it is back to pending. */
function claimAfter(delivery: DeliveryRecord, step: DeliveryStep): DeliveryRecord['claimedBy'] {
  switch (step.state) {
    case 'received':
    case 'handed':
      return step.shipId ?? delivery.claimedBy;
    case 'pending':
      return null;
    case 'undeliverable':
    case 'acknowledged':
    case 'handled':
    case 'notHandled':
    case 'dismissed':
    case 'abandoned':
      return delivery.claimedBy;
  }
}

function turnOf(event: SequencedEvent): LeaseTurnFact | undefined {
  const { leaseId, turn } = event.details;
  const state = turnStateSchema.safeParse(turn);
  return event.type === 'TurnReported' && isId(leaseId, 'lease') && state.success ? { leaseId, turn: { state: state.data, at: event.occurredAt } } : undefined;
}

/**
 * Folds the events, lowest `seq` first, up to the first one past `until`
 * when given: a delivery sent among them joins, as `sent` describes it; a
 * step replaces its delivery's; a delivery that leaves the open states goes,
 * an acknowledged one with its wait; a turn replaces its lease's. An event of
 * a delivery it does not hold, or a step it already holds, changes nothing,
 * so an event folded again is harmless.
 */
export function foldHealth(fold: HealthFold, read: { events: readonly SequencedEvent[]; sent: readonly DeliveryRecord[]; until?: Date }): Folded {
  const deliveries = new Map<DeliveryId, DeliveryRecord>(fold.deliveries.map((delivery) => [delivery.deliveryId, delivery]));
  const turns = new Map<LeaseId, LeaseTurn>(fold.turns.map(({ leaseId, turn }) => [leaseId, turn]));
  const sent = new Map<DeliveryId, DeliveryRecord>(read.sent.map((delivery) => [delivery.deliveryId, delivery]));
  const acknowledged: AcknowledgedDelivery[] = [];
  let seq = fold.seq;
  for (const event of read.events) {
    if (read.until !== undefined && event.occurredAt > read.until) {
      break;
    }
    seq = event.seq;
    const turn = turnOf(event);
    if (turn !== undefined) {
      turns.set(turn.leaseId, turn.turn);
    }
    const { deliveryId } = event;
    if (deliveryId === undefined) {
      continue;
    }
    const joining = sent.get(deliveryId);
    if (event.type === 'MessageAccepted' && joining !== undefined && !deliveries.has(deliveryId)) {
      deliveries.set(deliveryId, joining);
    }
    const delivery = deliveries.get(deliveryId);
    const step = stateStepOf(event);
    if (delivery === undefined || step === undefined || isSameStep(delivery.steps.at(-1), step)) {
      continue;
    }
    if (OPEN_STATES.has(step.state)) {
      deliveries.set(deliveryId, { ...delivery, claimedBy: claimAfter(delivery, step), steps: [step] });
      continue;
    }
    deliveries.delete(deliveryId);
    if (step.state === 'acknowledged') {
      const { senderId, recipient, claimedBy } = delivery;
      acknowledged.push({ sentAt: delivery.sentAt, acknowledgedAt: step.at, message: { senderId, recipient, claimedBy } });
    }
  }
  return { fold: { seq, deliveries: [...deliveries.values()], turns: [...turns].map(([leaseId, turn]) => ({ leaseId, turn })) }, acknowledged };
}

/**
 * The fold at `at` from the fleet's records, replayed as the stuck rule reads
 * them, for a fleet's first snapshot: the deliveries sent by then and open
 * then, each at its latest step by then, and each lease at its latest turn by
 * then, as of the event `seq`.
 */
export function foldAt(records: FleetRecords, read: { at: Date; seq: number }): HealthFold {
  const { at, seq } = read;
  const deliveries = records.deliveries.flatMap((delivery) => {
    const latest = delivery.steps.filter((step) => step.at <= at).at(-1);
    const isOpen = delivery.sentAt <= at && (latest === undefined || OPEN_STATES.has(latest.state));
    return isOpen ? [{ ...delivery, steps: latest === undefined ? [] : [latest] }] : [];
  });
  const turns = records.leases.flatMap(({ leaseId, turns: reported }) => {
    const turn = reported.filter((one) => one.at <= at).at(-1);
    return turn === undefined ? [] : [{ leaseId, turn }];
  });
  return { seq, deliveries, turns };
}
