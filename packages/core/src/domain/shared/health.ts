/**
 * A fleet's health (decision 0042): where its deliveries are stuck now, with
 * the ship or type and the machine behind each ship, how many were stuck at
 * each hour of the last 7 days, and how many were acknowledged in the last 24
 * hours. Facts read from the fleet's records, never stored.
 */
import { STUCK_TREND_HOURS, type FleetId, type ShipId, type StuckCause } from '@aeolus-fleet/common';

import type { HistoryParty } from './history.js';
import { stuckAt, stuckPerHour, stuckPlaces, type FleetRecords } from './stuck.js';

const HOUR_MS = 60 * 60 * 1000;

/** How far back the acknowledged deliveries are counted. */
export const ACKNOWLEDGED_WINDOW_HOURS = 24;

/** A machine: the trierarch a ship's crew request is assigned to, and when its crew last called. */
export interface Machine extends HistoryParty {
  lastSeenAt: Date | null;
}

/** The deliveries acknowledged in a window, and the median from send to acknowledgement. */
export interface Acknowledged {
  count: number;
  /** None when nothing was acknowledged. */
  medianMs: number | null;
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
  /** The fleet's deliveries acknowledged at or after `since`. */
  acknowledged(fleetId: FleetId, since: Date): Promise<Acknowledged>;
}

/** Where deliveries are stuck: a ship, by name, with its machine if any, or a type. */
export type ShownStuckPlace = { kind: 'ship'; ship: HistoryParty; machine: Machine | null } | { kind: 'type'; type: string };

export interface StuckPlaceHealth {
  cause: StuckCause;
  place: ShownStuckPlace;
  count: number;
  oldestSince: Date;
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
  return new Date(now.getTime() - ACKNOWLEDGED_WINDOW_HOURS * HOUR_MS);
}

/** Reads the fleet's health at `now`: its records over the trend's hours and its acknowledged in the last 24. */
export async function readHealthOf(records: HealthRecords, read: { fleetId: FleetId; now: Date }): Promise<Health> {
  const [facts, acknowledged] = await Promise.all([records.read(read.fleetId, healthSince(read.now)), records.acknowledged(read.fleetId, acknowledgedSince(read.now))]);
  return healthOf(facts, { acknowledged, now: read.now });
}

export function healthOf(facts: HealthFacts, read: { acknowledged: Acknowledged; now: Date }): Health {
  const shown = (place: { kind: 'ship'; shipId: ShipId } | { kind: 'type'; type: string }): ShownStuckPlace => {
    if (place.kind === 'type') {
      return place;
    }
    const name = facts.ships.find((ship) => ship.shipId === place.shipId)?.name ?? place.shipId;
    const machine = facts.machines.find((assigned) => assigned.shipId === place.shipId)?.machine ?? null;
    return { kind: 'ship', ship: { id: place.shipId, name }, machine };
  };
  return {
    stuck: stuckPlaces(stuckAt(facts, read.now)).map(({ place, ...counted }) => ({ ...counted, place: shown(place) })),
    stuckPerHour: stuckPerHour(facts, read.now),
    acknowledged: read.acknowledged,
  };
}
