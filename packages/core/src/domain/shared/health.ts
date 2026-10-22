/**
 * A fleet's health (decision 0042): where its deliveries are stuck now, with
 * the ship or type and the machine behind each ship, how many were stuck at
 * each hour of the last 7 days, and how many were acknowledged in the last 24
 * hours. Facts read from the fleet's records, never stored.
 */
import { ACKNOWLEDGED_HOURS, STUCK_TREND_HOURS, type FleetId, type ShipId } from '@aeolus-fleet/common';

import type { MessageParties } from '../registry/public.js';
import type { HistoryParty } from './history.js';
import { stuckAt, stuckPerHour, stuckPlaces, type FleetRecords, type StuckDelivery, type StuckPlace, type StuckPlaceCount } from './stuck.js';

const HOUR_MS = 60 * 60 * 1000;

/** A machine: the trierarch a ship's crew request is assigned to, and when its crew last called. */
export interface Machine extends HistoryParty {
  lastSeenAt: Date | null;
}

/** A delivery acknowledged in the window: when its message was sent and when it was acknowledged, and its message's parties. */
export interface AcknowledgedDelivery {
  sentAt: Date;
  acknowledgedAt: Date;
  message: MessageParties;
}

/** The deliveries acknowledged in the last 24 hours, the median from send to acknowledgement, and how many in each hour. */
export interface Acknowledged {
  count: number;
  /** None when nothing was acknowledged. */
  medianMs: number | null;
  /** Oldest first, each hour ending at `at`, the last one now. */
  perHour: { at: Date; count: number }[];
}

/** What the health reads: the stuck rule's records, with the machine behind each ship whose crew request is assigned. */
export interface HealthFacts extends FleetRecords {
  machines: readonly { shipId: ShipId; machine: Machine }[];
}

/** Outbound port: the records the health reads, always within one fleet. */
export interface HealthRecords {
  /**
   * The fleet's ships and leases not over before `since`, and its deliveries
   * open now or with a step since then, each with every step it took.
   */
  read(fleetId: FleetId, since: Date): Promise<HealthFacts>;
  /** The fleet's deliveries acknowledged after `since`. */
  acknowledged(fleetId: FleetId, since: Date): Promise<AcknowledgedDelivery[]>;
}

/** Where deliveries are stuck: a ship, by name, with its machine if any, or a type. */
export type ShownStuckPlace = { kind: 'ship'; ship: HistoryParty; machine: Machine | null } | { kind: 'type'; type: string };

export interface StuckPlaceHealth extends Omit<StuckPlaceCount, 'place'> {
  place: ShownStuckPlace;
}

export interface Health {
  /** Stuck now, by cause and place, the oldest waiting first. */
  stuck: StuckPlaceHealth[];
  /** Stuck at each hour of the last 7 days, oldest first, the last one now. */
  stuckPerHour: { at: Date; count: number }[];
  /** Acknowledged in the last 24 hours. */
  acknowledged: Acknowledged;
}

/** Since when the health reads the records for a read at `now`: the first hour of its trend. */
export function healthSince(now: Date): Date {
  return new Date(now.getTime() - STUCK_TREND_HOURS * HOUR_MS);
}

/** Since when it counts the acknowledged deliveries for a read at `now`. */
export function acknowledgedSince(now: Date): Date {
  return new Date(now.getTime() - ACKNOWLEDGED_HOURS * HOUR_MS);
}

/** The middle wait, or the mean of the two middle ones; none of none. */
function medianOf(waits: readonly number[]): number | null {
  const sorted = waits.toSorted((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) {
    return null;
  }
  const lower = sorted[middle - 1];
  return sorted.length % 2 === 1 || lower === undefined ? upper : (lower + upper) / 2;
}

/** Counts the deliveries acknowledged in the 24 hours up to `now`, with their median wait and how many in each hour. */
export function acknowledgedOf(deliveries: readonly AcknowledgedDelivery[], now: Date): Acknowledged {
  const inWindow = deliveries.filter((delivery) => delivery.acknowledgedAt > acknowledgedSince(now) && delivery.acknowledgedAt <= now);
  const perHour = Array.from({ length: ACKNOWLEDGED_HOURS }, (_unused, index) => {
    const at = new Date(now.getTime() - (ACKNOWLEDGED_HOURS - 1 - index) * HOUR_MS);
    const from = at.getTime() - HOUR_MS;
    return { at, count: inWindow.filter((delivery) => delivery.acknowledgedAt.getTime() > from && delivery.acknowledgedAt <= at).length };
  });
  return { count: inWindow.length, medianMs: medianOf(inWindow.map((delivery) => delivery.acknowledgedAt.getTime() - delivery.sentAt.getTime())), perHour };
}

/**
 * Reads the fleet's health at `now`: its records over the trend's hours and
 * its acknowledged in the last 24, counting only the deliveries whose message
 * `reads` keeps, every one without it. A ship `readsShip` leaves out is shown
 * by name only, without the machine behind it (decision 0034).
 */
export async function readHealthOf(
  records: HealthRecords,
  read: { fleetId: FleetId; now: Date; reads?: (message: MessageParties) => boolean; readsShip?: (shipId: ShipId) => boolean },
): Promise<Health> {
  const { fleetId, now, reads = () => true, readsShip = () => true } = read;
  const [facts, acknowledged] = await Promise.all([records.read(fleetId, healthSince(now)), records.acknowledged(fleetId, acknowledgedSince(now))]);
  const deliveries = facts.deliveries.filter(({ senderId, recipient, claimedBy }) => reads({ senderId, recipient, claimedBy }));
  const machines = facts.machines.filter(({ shipId }) => readsShip(shipId));
  return healthOf({ ...facts, deliveries, machines }, { acknowledged: acknowledgedOf(acknowledged.filter((delivery) => reads(delivery.message)), now), now });
}

/** The stuck deliveries by cause and place, each ship by name with the machine behind it. */
export function shownStuck(stuck: readonly StuckDelivery[], facts: Pick<HealthFacts, 'ships' | 'machines'>): StuckPlaceHealth[] {
  const shown = (place: StuckPlace): ShownStuckPlace => {
    if (place.kind === 'type') {
      return place;
    }
    const name = facts.ships.find((ship) => ship.shipId === place.shipId)?.name ?? place.shipId;
    const machine = facts.machines.find((assigned) => assigned.shipId === place.shipId)?.machine ?? null;
    return { kind: 'ship', ship: { id: place.shipId, name }, machine };
  };
  return stuckPlaces(stuck).map(({ place, ...counted }) => ({ ...counted, place: shown(place) }));
}

export function healthOf(facts: HealthFacts, read: { acknowledged: Acknowledged; now: Date }): Health {
  return {
    stuck: shownStuck(stuckAt(facts, read.now), facts),
    stuckPerHour: stuckPerHour(facts, read.now),
    acknowledged: read.acknowledged,
  };
}
