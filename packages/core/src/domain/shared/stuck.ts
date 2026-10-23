/**
 * Stuck deliveries (decision 0042): a delivery that waits on something only a
 * ship, a crew or the operator can change. One rule, read at any time from the
 * fleet's records, so the deliveries stuck now and the trend replayed over 7
 * days count alike. Facts only: no thresholds of its own beyond the clocks the
 * pushed leases already run (decision 0040).
 */
import { isId, STUCK_TREND_HOURS, type DeliveryId, type DeliveryState, type EventType, type LeaseId, type MessageId, type ShipId, type StuckCause, type StuckState, type TurnState } from '@aeolus-fleet/common';

import { hasClockRunOut, NOT_CONFIRMED_MINUTES } from '../messaging/public.js';
import type { FleetEvent } from './events.js';
import type { Recipient } from './selector.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;


/** Where a delivery is stuck: at a ship, or at the type it was sent to. */
export type StuckPlace = { kind: 'ship'; shipId: ShipId } | { kind: 'type'; type: string };

export interface StuckDelivery {
  deliveryId: DeliveryId;
  messageId: MessageId;
  state: StuckState;
  cause: StuckCause;
  place: StuckPlace;
  /** When it entered the state it is stuck in. */
  since: Date;
}

/**
 * A ship as the rule reads it over time; argo and the viewer ship are always
 * crewed. A person ship awaiting crew is its person away, never stuck
 * (decision 0044).
 */
export interface ShipRecord {
  shipId: ShipId;
  name: string;
  type: string;
  isAlwaysCrewed: boolean;
  isPerson: boolean;
  commissionedAt: Date;
  retiredAt: Date | null;
}

/** A turn a pushed session's hooks reported, at the time they saw it. */
export interface LeaseTurn {
  state: TurnState;
  at: Date;
}

/** A lease as the rule reads it over time: when it was held, pushed, last seen, and its turns oldest first. */
export interface LeaseRecord {
  leaseId: LeaseId;
  shipId: ShipId;
  startedAt: Date;
  endedAt: Date | null;
  pushedAt: Date | null;
  /** When its crew last called, else when it started: one column, not a history, so the trend reads it as it is now. */
  lastSeenAt: Date;
  turns: readonly LeaseTurn[];
}

/**
 * A change of a delivery's state, to `state` at `at`, by the crew of
 * `shipId` and `leaseId` when one caused it. A receipt again and a hand-over
 * once more change no state, so they are no step.
 */
export interface DeliveryStep {
  state: DeliveryState;
  at: Date;
  shipId: ShipId | null;
  leaseId: LeaseId | null;
}

/** The state each delivery event puts its delivery in. */
const STEP_STATES: Partial<Record<EventType, DeliveryState>> = {
  DeliveryReceived: 'received',
  DeliveryHanded: 'handed',
  DeliveryReturned: 'pending',
  DeliveryAcknowledged: 'acknowledged',
  DeliveryHandled: 'handled',
  DeliveryNotHandled: 'notHandled',
  DeliveryUndeliverable: 'undeliverable',
  DeliveryDismissed: 'dismissed',
  DeliveryAbandoned: 'abandoned',
};

/** The step a delivery event is, or none for an event that changes no state: a receipt again, a hand-over once more, or no delivery event at all. */
export function stateStepOf(event: Pick<FleetEvent, 'type' | 'occurredAt' | 'shipId' | 'details'>): DeliveryStep | undefined {
  const state = STEP_STATES[event.type];
  if (state === undefined || event.details.again === true || event.details.onceMore === true) {
    return undefined;
  }
  const { leaseId } = event.details;
  return { state, at: event.occurredAt, shipId: event.shipId ?? null, leaseId: isId(leaseId, 'lease') ? leaseId : null };
}

/** A delivery, pending from when it was sent, then through its steps oldest first. */
export interface DeliveryRecord {
  deliveryId: DeliveryId;
  messageId: MessageId;
  /** Its message's sender, by which read reach reads it (decision 0034). */
  senderId: ShipId;
  recipient: Recipient;
  /** The ship that holds its claim, as the delivery records it; none while none does. */
  claimedBy: ShipId | null;
  /** The ships of its type its sender could reach at send time; empty is every ship of the type (decision 0034). */
  reachableShipIds: readonly ShipId[];
  sentAt: Date;
  steps: readonly DeliveryStep[];
}

/** What the rule reads: the fleet's ships, leases and deliveries over the time it is read for. */
export interface FleetRecords {
  ships: readonly ShipRecord[];
  leases: readonly LeaseRecord[];
  deliveries: readonly DeliveryRecord[];
}

/** A delivery's state at a time, since when, and the crew of the step that put it there. */
interface StateAt {
  state: DeliveryState;
  since: Date;
  shipId: ShipId | null;
  leaseId: LeaseId | null;
}

function stateAt(delivery: DeliveryRecord, at: Date): StateAt | undefined {
  if (delivery.sentAt > at) {
    return undefined;
  }
  return delivery.steps
    .filter((step) => step.at <= at)
    .reduce<StateAt>((_state, step) => ({ state: step.state, since: step.at, shipId: step.shipId, leaseId: step.leaseId }), {
      state: 'pending',
      since: delivery.sentAt,
      shipId: null,
      leaseId: null,
    });
}

function isActiveAt(ship: ShipRecord, at: Date): boolean {
  return ship.commissionedAt <= at && (ship.retiredAt === null || ship.retiredAt > at);
}

function isHeldAt(lease: LeaseRecord, at: Date): boolean {
  return lease.startedAt <= at && (lease.endedAt === null || lease.endedAt > at);
}

function isPushedAt(lease: LeaseRecord, at: Date): lease is LeaseRecord & { pushedAt: Date } {
  return lease.pushedAt !== null && lease.pushedAt <= at;
}

/** The turn its hooks had reported by then, or none yet. */
function turnAt(lease: LeaseRecord, at: Date): LeaseTurn | null {
  return lease.turns.filter((turn) => turn.at <= at).at(-1) ?? null;
}

/** Reads the rule at one time over the fleet's records. */
class FleetAt {
  constructor(
    private readonly records: FleetRecords,
    private readonly at: Date,
  ) {}

  leaseOf(shipId: ShipId): LeaseRecord | undefined {
    return this.records.leases.find((lease) => lease.shipId === shipId && isHeldAt(lease, this.at));
  }

  isCrewed(ship: ShipRecord): boolean {
    return ship.isAlwaysCrewed || this.leaseOf(ship.shipId) !== undefined;
  }

  /** The active ships that may take it: its ship, or the reachable ships of its type. */
  takers(delivery: DeliveryRecord): ShipRecord[] {
    const { recipient } = delivery;
    return this.records.ships.filter((ship) => {
      if (!isActiveAt(ship, this.at)) {
        return false;
      }
      if (recipient.kind === 'ship') {
        return ship.shipId === recipient.shipId;
      }
      return ship.type === recipient.type && (delivery.reachableShipIds.length === 0 || delivery.reachableShipIds.includes(ship.shipId));
    });
  }

  /** The pushed lease whose clock ran out on a delivery waiting for it, if any. */
  overdueOn(delivery: { state: 'pending' | 'received' | 'handed'; since: Date }, leases: readonly LeaseRecord[]): LeaseRecord | undefined {
    return leases.find(
      (lease) => isPushedAt(lease, this.at) && hasClockRunOut(delivery, { crew: { pushedAt: lease.pushedAt, turn: turnAt(lease, this.at) }, now: this.at }),
    );
  }

  stuck(delivery: DeliveryRecord): StuckDelivery | undefined {
    const now = stateAt(delivery, this.at);
    if (now === undefined) {
      return undefined;
    }
    const why = this.whyStuck(delivery, now);
    return why === undefined ? undefined : { deliveryId: delivery.deliveryId, messageId: delivery.messageId, ...why, since: now.since };
  }

  private whyStuck(delivery: DeliveryRecord, now: StateAt): { state: StuckState; cause: StuckCause; place: StuckPlace } | undefined {
    const inState = (state: StuckState, why: { cause: StuckCause; place: StuckPlace } | undefined) => (why === undefined ? undefined : { state, ...why });
    switch (now.state) {
      case 'undeliverable':
        return inState('undeliverable', { cause: 'undeliverable', place: now.shipId === null ? placeOf(delivery.recipient) : { kind: 'ship', shipId: now.shipId } });
      case 'pending':
        return inState('pending', this.whyPendingStuck(delivery, now.since));
      case 'received':
      case 'handed':
        return inState(now.state, this.whyInFlightStuck({ state: now.state, since: now.since, leaseId: now.leaseId }));
      case 'acknowledged':
      case 'handled':
      case 'notHandled':
      case 'dismissed':
      case 'abandoned':
        return undefined;
    }
  }

  private whyPendingStuck(delivery: DeliveryRecord, since: Date): { cause: StuckCause; place: StuckPlace } | undefined {
    const takers = this.takers(delivery);
    if (takers.length === 0) {
      // A direct delivery to a retired ship is abandoned, so only a type's comes here.
      return { cause: 'noShipCanTake', place: placeOf(delivery.recipient) };
    }
    const crewed = takers.filter((ship) => this.isCrewed(ship));
    if (crewed.length === 0) {
      return takers.some((ship) => ship.isPerson) ? undefined : { cause: 'waitingForCrew', place: placeOf(delivery.recipient) };
    }
    // A person away is not stuck (interop 5.1): only the clocks of other crewed ships speak for it.
    const leases = crewed.filter((ship) => !ship.isPerson).flatMap((ship) => this.leaseOf(ship.shipId) ?? []);
    const overdue = this.overdueOn({ state: 'pending', since }, leases);
    return overdue === undefined ? undefined : { cause: 'stalledInFlight', place: { kind: 'ship', shipId: overdue.shipId } };
  }

  private whyInFlightStuck(delivery: { state: 'received' | 'handed'; since: Date; leaseId: LeaseId | null }): { cause: StuckCause; place: StuckPlace } | undefined {
    const lease = this.records.leases.find((held) => held.leaseId === delivery.leaseId);
    if (lease === undefined || this.records.ships.some((ship) => ship.shipId === lease.shipId && ship.isPerson)) {
      // A person away is not stuck (interop 5.1): handed and not opened is a fact with its age, not trouble.
      return undefined;
    }
    const isStalled = isPushedAt(lease, this.at) ? this.overdueOn(delivery, [lease]) !== undefined : isQuietSinceHandOver(lease, { delivery, at: this.at });
    return isStalled ? { cause: 'stalledInFlight', place: { kind: 'ship', shipId: lease.shipId } } : undefined;
  }
}

/**
 * A plain lease has no clock (decision 0010): its session is quiet when it was
 * last seen no later than the hand-over, and the hand-over is as old as the
 * pushed lease's not confirmed clock.
 */
function isQuietSinceHandOver(lease: LeaseRecord, read: { delivery: { state: 'received' | 'handed'; since: Date }; at: Date }): boolean {
  const { delivery, at } = read;
  return (
    delivery.state === 'handed' &&
    lease.lastSeenAt <= delivery.since &&
    at.getTime() - delivery.since.getTime() >= NOT_CONFIRMED_MINUTES * MINUTE_MS
  );
}

function placeOf(recipient: Recipient): StuckPlace {
  return recipient.kind === 'ship' ? { kind: 'ship', shipId: recipient.shipId } : { kind: 'type', type: recipient.type };
}

function bySince(first: { since: Date; deliveryId: DeliveryId }, second: { since: Date; deliveryId: DeliveryId }): number {
  return first.since.getTime() - second.since.getTime() || first.deliveryId.localeCompare(second.deliveryId);
}

/** The deliveries stuck at `at`, each with its cause, place and since, oldest first. */
export function stuckAt(records: FleetRecords, at: Date): StuckDelivery[] {
  const fleet = new FleetAt(records, at);
  return records.deliveries.flatMap((delivery) => fleet.stuck(delivery) ?? []).toSorted(bySince);
}

/** How many deliveries were stuck at each hour of the last 7 days, oldest first, the last one now. */
export function stuckPerHour(records: FleetRecords, now: Date): { at: Date; count: number }[] {
  return Array.from({ length: STUCK_TREND_HOURS }, (_unused, index) => {
    const at = new Date(now.getTime() - (STUCK_TREND_HOURS - 1 - index) * HOUR_MS);
    return { at, count: stuckAt(records, at).length };
  });
}

/** A place deliveries are stuck in for one cause: how many, and since when the oldest waits. */
export interface StuckPlaceCount {
  cause: StuckCause;
  place: StuckPlace;
  count: number;
  oldestSince: Date;
  /** Each one, oldest first. */
  deliveries: { deliveryId: DeliveryId; messageId: MessageId; state: StuckState; since: Date }[];
}

export function isSamePlace(first: StuckPlace, second: StuckPlace): boolean {
  return first.kind === 'ship' ? second.kind === 'ship' && first.shipId === second.shipId : second.kind === 'type' && first.type === second.type;
}

/** The stuck deliveries grouped by cause and place, the oldest waiting first. */
export function stuckPlaces(stuck: readonly StuckDelivery[]): StuckPlaceCount[] {
  const places: StuckPlaceCount[] = [];
  for (const delivery of stuck.toSorted(bySince)) {
    const index = places.findIndex((counted) => counted.cause === delivery.cause && isSamePlace(counted.place, delivery.place));
    const counted = places[index];
    const one = { deliveryId: delivery.deliveryId, messageId: delivery.messageId, state: delivery.state, since: delivery.since };
    if (counted === undefined) {
      places.push({ cause: delivery.cause, place: delivery.place, count: 1, oldestSince: delivery.since, deliveries: [one] });
    } else {
      places[index] = { ...counted, count: counted.count + 1, deliveries: [...counted.deliveries, one] };
    }
  }
  return places;
}
