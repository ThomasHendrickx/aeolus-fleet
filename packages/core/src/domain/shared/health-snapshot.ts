/**
 * The stuck snapshot (docs/design/performance/performance.md, sections 5 and
 * 6): one row per fleet and closed hour holds what was stuck at its hour mark
 * and the waits acknowledged in its hour, each counted by the message's
 * parties so a read counts only what its caller reads (decision 0034). The
 * latest hour also keeps the fold, so a read folds only the events after it.
 * The rule is `stuck.ts`'s, at each hour mark and at now alike (decision 0042).
 */
import { ACKNOWLEDGED_HOURS, STUCK_TREND_HOURS, type FleetId, type ShipId, type StuckCause } from '@aeolus-fleet/common';

import type { MessageParties } from '../registry/public.js';
import type { SequencedEvent } from './events.js';
import { foldAt, foldHealth, type HealthFold } from './health-fold.js';
import { shownStuck, type AcknowledgedDelivery, type Health, type HealthFacts } from './health.js';
import { isSamePlace, stuckAt, type DeliveryRecord, type FleetRecords, type LeaseRecord, type ShipRecord, type StuckPlace } from './stuck.js';
import { medianOfWaits, waitsOf, type WaitBuckets } from './wait-buckets.js';

const HOUR_MS = 60 * 60 * 1000;

/** The deliveries stuck at an hour mark for one cause, at one place, of one message's parties: how many, and since when the oldest. */
export interface StuckCount {
  cause: StuckCause;
  place: StuckPlace;
  message: MessageParties;
  count: number;
  oldestSince: Date;
}

/** The waits from send to acknowledgement of the deliveries of one message's parties acknowledged in an hour. */
export interface AcknowledgedCount {
  message: MessageParties;
  waits: WaitBuckets;
}

/** A closed hour: stuck at its mark, and acknowledged in the hour up to it. */
export interface HourSnapshot {
  hour: Date;
  stuck: readonly StuckCount[];
  acknowledged: readonly AcknowledgedCount[];
}

/** The latest closed hour and the fold as of it. */
export interface LatestSnapshot {
  hour: Date;
  fold: HealthFold;
}

/** The ships, leases and machines the rule reads beside the fold; the leases' turns come from the fold. */
export interface HealthCrews {
  ships: readonly ShipRecord[];
  leases: readonly LeaseRecord[];
  machines: HealthFacts['machines'];
}

/** The events after a seq, lowest first, and the deliveries those events sent. */
export interface EventsAfter {
  events: readonly SequencedEvent[];
  sent: readonly DeliveryRecord[];
}

/** Outbound port: the fleet's stuck snapshot, always within one fleet. */
export interface HealthSnapshots {
  /** The latest closed hour with its fold; none before the fleet's first snapshot. */
  latest(fleetId: FleetId): Promise<LatestSnapshot | undefined>;
  /** The closed hours after `since`, oldest first. */
  hours(fleetId: FleetId, since: Date): Promise<HourSnapshot[]>;
  /** The fleet's events after `seq` and the deliveries they sent. */
  eventsAfter(fleetId: FleetId, seq: number): Promise<EventsAfter>;
  /** The ships and leases not over before `since`, and the machine behind each ship. */
  crews(fleetId: FleetId, since: Date): Promise<HealthCrews>;
}

/** Outbound port in a unit of work: writes the fleet's stuck snapshot, one instance at a time. */
export interface HealthSnapshotWriter extends HealthSnapshots {
  /** Takes the fleet's snapshot lock until the unit of work ends; false while another instance holds it. */
  tryLock(fleetId: FleetId): Promise<boolean>;
  /** The last event before the first one that occurred after `hour`; the fleet's last event when none did. */
  seqAt(fleetId: FleetId, hour: Date): Promise<number>;
  /**
   * Writes the hours, oldest first, each only where no row holds its hour yet.
   * When the last one went in, the fold is the latest's and the hours more than
   * 168 before it go.
   */
  write(fleetId: FleetId, snapshot: { hours: readonly HourSnapshot[]; fold: HealthFold }): Promise<void>;
}

/** The hour mark at or before `at`. */
export function hourMarkOf(at: Date): Date {
  return new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);
}

function hoursAfter(mark: Date, hours: number): Date {
  return new Date(mark.getTime() + hours * HOUR_MS);
}

function partiesOf(delivery: DeliveryRecord): MessageParties {
  return { senderId: delivery.senderId, recipient: delivery.recipient, claimedBy: delivery.claimedBy };
}

function isSameMessage(first: MessageParties, second: MessageParties): boolean {
  const isSameRecipient =
    first.recipient.kind === 'ship'
      ? second.recipient.kind === 'ship' && first.recipient.shipId === second.recipient.shipId
      : second.recipient.kind === 'type' && first.recipient.type === second.recipient.type;
  return first.senderId === second.senderId && first.claimedBy === second.claimedBy && isSameRecipient;
}

function recordsOf(crews: HealthCrews, fold: HealthFold): FleetRecords {
  const turns = new Map(fold.turns.map(({ leaseId, turn }) => [leaseId, turn]));
  return {
    ships: crews.ships,
    leases: crews.leases.map((lease) => {
      const turn = turns.get(lease.leaseId);
      return { ...lease, turns: turn === undefined ? [] : [turn] };
    }),
    deliveries: fold.deliveries,
  };
}

/** The hour at `hour` from the records: what was stuck at the mark, and the waits of `acknowledged`, the deliveries acknowledged in the hour. */
export function hourSnapshotOf(records: FleetRecords, read: { hour: Date; acknowledged: readonly AcknowledgedDelivery[] }): HourSnapshot {
  const deliveries = new Map(records.deliveries.map((delivery) => [delivery.deliveryId, delivery]));
  const stuck: StuckCount[] = [];
  for (const one of stuckAt(records, read.hour)) {
    const delivery = deliveries.get(one.deliveryId);
    if (delivery === undefined) {
      continue;
    }
    const message = partiesOf(delivery);
    const index = stuck.findIndex((counted) => counted.cause === one.cause && isSamePlace(counted.place, one.place) && isSameMessage(counted.message, message));
    const counted = stuck[index];
    if (counted === undefined) {
      stuck.push({ cause: one.cause, place: one.place, message, count: 1, oldestSince: one.since });
    } else {
      stuck[index] = { ...counted, count: counted.count + 1 };
    }
  }
  const byMessage: { message: MessageParties; waitsMs: number[] }[] = [];
  for (const { message, sentAt, acknowledgedAt } of read.acknowledged) {
    const waitMs = acknowledgedAt.getTime() - sentAt.getTime();
    const counted = byMessage.find((held) => isSameMessage(held.message, message));
    if (counted === undefined) {
      byMessage.push({ message, waitsMs: [waitMs] });
    } else {
      counted.waitsMs.push(waitMs);
    }
  }
  return { hour: read.hour, stuck, acknowledged: byMessage.map(({ message, waitsMs }) => ({ message, waits: waitsOf(waitsMs) })) };
}

/** Closes the hour after the latest: folds the events after its seq up to the next hour mark, and counts at that mark. */
export function closeHour(latest: LatestSnapshot, read: EventsAfter & { crews: HealthCrews }): { hour: HourSnapshot; fold: HealthFold } {
  const mark = hoursAfter(latest.hour, 1);
  const events = read.events.filter((event) => event.seq > latest.fold.seq);
  const { fold, acknowledged } = foldHealth(latest.fold, { events, sent: read.sent, until: mark });
  return { hour: hourSnapshotOf(recordsOf(read.crews, fold), { hour: mark, acknowledged }), fold };
}

/**
 * A fleet's first snapshot, replayed from its records as the health read them
 * before (decision 0042): each of the 168 hours up to `lastHour`, with the
 * waits of `acknowledged` in each, and the fold at `lastHour` as of `seq`.
 */
export function firstSnapshot(records: FleetRecords, read: { lastHour: Date; seq: number; acknowledged: readonly AcknowledgedDelivery[] }): { hours: HourSnapshot[]; fold: HealthFold } {
  const hours = Array.from({ length: STUCK_TREND_HOURS }, (_unused, index) => {
    const hour = hoursAfter(read.lastHour, index - STUCK_TREND_HOURS + 1);
    const from = hoursAfter(hour, -1);
    return hourSnapshotOf(records, { hour, acknowledged: read.acknowledged.filter(({ acknowledgedAt }) => acknowledgedAt > from && acknowledgedAt <= hour) });
  });
  return { hours, fold: foldAt(records, { at: read.lastHour, seq: read.seq }) };
}

function waitCount(waits: WaitBuckets): number {
  return [...waits.values()].reduce((sum, count) => sum + count, 0);
}

/**
 * The health at `now` from the snapshot: the hours it has not closed yet are
 * folded as a close would, then the rest of the events up to now. Stuck now
 * and in each hour count only the deliveries whose message `reads` keeps; an
 * hour with no row counts none. Acknowledged counts the 23 closed hours
 * before the open one and the open one; a ship `readsShip` leaves out is
 * shown without its machine (decision 0034).
 */
export function healthFromSnapshot(
  snapshot: EventsAfter & { latest: LatestSnapshot; hours: readonly HourSnapshot[]; crews: HealthCrews },
  read: { now: Date; reads: (message: MessageParties) => boolean; readsShip: (shipId: ShipId) => boolean },
): Health {
  const { now, reads, readsShip } = read;
  const lastMark = hourMarkOf(now);
  const hours = [...snapshot.hours];
  let latest = snapshot.latest;
  while (latest.hour < lastMark) {
    const closed = closeHour(latest, snapshot);
    hours.push(closed.hour);
    latest = { hour: closed.hour.hour, fold: closed.fold };
  }
  const after = latest.fold.seq;
  const { fold, acknowledged } = foldHealth(latest.fold, { events: snapshot.events.filter((event) => event.seq > after), sent: snapshot.sent });
  const records = recordsOf(snapshot.crews, { ...fold, deliveries: fold.deliveries.filter((delivery) => reads(partiesOf(delivery))) });
  const stuckNow = stuckAt(records, now);
  const hourAt = (mark: Date) => hours.find((hour) => hour.hour.getTime() === mark.getTime());

  const stuckPerHour = Array.from({ length: STUCK_TREND_HOURS - 1 }, (_unused, index) => {
    const at = hoursAfter(lastMark, index - STUCK_TREND_HOURS + 2);
    const count = (hourAt(at)?.stuck ?? []).filter((counted) => reads(counted.message)).reduce((sum, counted) => sum + counted.count, 0);
    return { at, count };
  });

  const closedWaits = Array.from({ length: ACKNOWLEDGED_HOURS - 1 }, (_unused, index) => {
    const at = hoursAfter(lastMark, index - ACKNOWLEDGED_HOURS + 2);
    return { at, waits: (hourAt(at)?.acknowledged ?? []).filter((counted) => reads(counted.message)).map((counted) => counted.waits) };
  });
  const openWaits = waitsOf(acknowledged.filter((delivery) => reads(delivery.message)).map(({ sentAt, acknowledgedAt }) => acknowledgedAt.getTime() - sentAt.getTime()));
  const perHour = [...closedWaits.map(({ at, waits }) => ({ at, count: waits.reduce((sum, one) => sum + waitCount(one), 0) })), { at: now, count: waitCount(openWaits) }];

  return {
    stuck: shownStuck(stuckNow, { ships: snapshot.crews.ships, machines: snapshot.crews.machines.filter(({ shipId }) => readsShip(shipId)) }),
    stuckPerHour: [...stuckPerHour, { at: now, count: stuckNow.length }],
    acknowledged: {
      count: perHour.reduce((sum, hour) => sum + hour.count, 0),
      medianMs: medianOfWaits([...closedWaits.flatMap(({ waits }) => waits), openWaits]),
      perHour,
    },
  };
}
