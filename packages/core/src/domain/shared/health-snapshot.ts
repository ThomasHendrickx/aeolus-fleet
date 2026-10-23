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
import { foldHealth, type HealthFold } from './health-fold.js';
import { shownStuck, type Acknowledged, type AcknowledgedDelivery, type Health, type HealthFacts } from './health.js';
import { isSamePlace, stuckAt, type DeliveryRecord, type FleetRecords, type LeaseRecord, type ShipRecord, type StuckDelivery, type StuckPlace } from './stuck.js';
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
  /** The fleet's events after `seq`, lowest first, at most `limit` of them when given, and the deliveries they sent. */
  eventsAfter(fleetId: FleetId, after: { seq: number; limit?: number }): Promise<EventsAfter>;
  /** The ships and leases not over before `since`, and the machine behind each ship. */
  crews(fleetId: FleetId, since: Date): Promise<HealthCrews>;
}

/** Outbound port in a unit of work: writes the fleet's stuck snapshot, one instance at a time. */
export interface HealthSnapshotWriter extends HealthSnapshots {
  /** Takes the fleet's snapshot lock until the unit of work ends; false while another instance holds it. */
  tryLock(fleetId: FleetId): Promise<boolean>;
  /**
   * The fold at `hour` for a fleet's first snapshot: the deliveries sent by
   * then and open then, each at its latest step by then, and each lease at its
   * latest turn by then, as of the last event before the first one that
   * occurred after `hour`.
   */
  baseAt(fleetId: FleetId, hour: Date): Promise<HealthFold>;
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

/** The hour at `hour` of a fold as of then: what was stuck at the mark, with no acknowledged waits. */
export function openingHourOf(fold: HealthFold, read: { hour: Date; crews: HealthCrews }): HourSnapshot {
  return hourSnapshotOf(recordsOf(read.crews, fold), { hour: read.hour, acknowledged: [] });
}

function waitCount(waits: WaitBuckets): number {
  return [...waits.values()].reduce((sum, count) => sum + count, 0);
}

/** An hour after the latest closed one, folded as its close would: the fold at its mark and what it acknowledged. */
export interface FoldedHour {
  hour: Date;
  fold: HealthFold;
  acknowledged: readonly AcknowledgedDelivery[];
}

/** The snapshot folded up to now: the hours it has not closed yet, then the rest of the events, with what they acknowledged. */
export interface FoldedToNow {
  hours: readonly FoldedHour[];
  fold: HealthFold;
  acknowledged: readonly AcknowledgedDelivery[];
}

/** Folds the hours the snapshot has not closed yet as a close would, then the rest of the events up to now. */
export function foldedToNow(snapshot: EventsAfter & { latest: LatestSnapshot }, now: Date): FoldedToNow {
  const lastMark = hourMarkOf(now);
  const hours: FoldedHour[] = [];
  let { hour, fold } = snapshot.latest;
  while (hour < lastMark) {
    const mark = hoursAfter(hour, 1);
    const after = fold.seq;
    const folded = foldHealth(fold, { events: snapshot.events.filter((event) => event.seq > after), sent: snapshot.sent, until: mark });
    hours.push({ hour: mark, ...folded });
    hour = mark;
    fold = folded.fold;
  }
  const after = fold.seq;
  return { hours, ...foldHealth(fold, { events: snapshot.events.filter((event) => event.seq > after), sent: snapshot.sent }) };
}

/** What is stuck at `now` in the fold, counting only the deliveries whose message `reads` keeps. */
export function stuckNowOf(crews: HealthCrews, read: { fold: HealthFold; now: Date; reads: (message: MessageParties) => boolean }): StuckDelivery[] {
  const { fold, now, reads } = read;
  return stuckAt(recordsOf(crews, { ...fold, deliveries: fold.deliveries.filter((delivery) => reads(partiesOf(delivery))) }), now);
}

/**
 * Stuck at each hour mark of the last 7 days, oldest first, from the closed
 * hours and the hours folded since, and `stuckNow` last at now. An hour with
 * no row counts none; each counts only the deliveries whose message `reads`
 * keeps.
 */
export function stuckPerHourOf(
  snapshot: { hours: readonly Pick<HourSnapshot, 'hour' | 'stuck'>[]; folded: readonly FoldedHour[]; crews: HealthCrews },
  read: { now: Date; stuckNow: number; reads: (message: MessageParties) => boolean },
): { at: Date; count: number }[] {
  const { now, reads } = read;
  const lastMark = hourMarkOf(now);
  const hours = [...snapshot.hours, ...snapshot.folded.map(({ hour, fold }) => openingHourOf(fold, { hour, crews: snapshot.crews }))];
  const perHour = Array.from({ length: STUCK_TREND_HOURS - 1 }, (_unused, index) => {
    const at = hoursAfter(lastMark, index - STUCK_TREND_HOURS + 2);
    const stuck = hours.find((hour) => hour.hour.getTime() === at.getTime())?.stuck ?? [];
    return { at, count: stuck.filter((counted) => reads(counted.message)).reduce((sum, counted) => sum + counted.count, 0) };
  });
  return [...perHour, { at: now, count: read.stuckNow }];
}

function waitsOfAcknowledged(acknowledged: readonly AcknowledgedDelivery[]): WaitBuckets {
  return waitsOf(acknowledged.map(({ sentAt, acknowledgedAt }) => acknowledgedAt.getTime() - sentAt.getTime()));
}

/**
 * Acknowledged in the last 24 hours: the 24 closed hours before the open one,
 * from the closed rows and the hours folded since, and the open one from
 * `acknowledged`, the rest of the events; per hour the last 23 of them and the
 * open one. Counts only the deliveries whose message `reads` keeps.
 */
export function acknowledgedOfSnapshot(
  snapshot: { hours: readonly Pick<HourSnapshot, 'hour' | 'acknowledged'>[]; folded: readonly FoldedHour[]; acknowledged: readonly AcknowledgedDelivery[] },
  read: { now: Date; reads: (message: MessageParties) => boolean },
): Acknowledged {
  const { now, reads } = read;
  const lastMark = hourMarkOf(now);
  const closedWaits = Array.from({ length: ACKNOWLEDGED_HOURS }, (_unused, index) => {
    const at = hoursAfter(lastMark, index - ACKNOWLEDGED_HOURS + 1);
    const closed = snapshot.hours.find((hour) => hour.hour.getTime() === at.getTime());
    const folded = snapshot.folded.find((hour) => hour.hour.getTime() === at.getTime());
    const waits = [
      ...(closed?.acknowledged ?? []).filter((counted) => reads(counted.message)).map((counted) => counted.waits),
      waitsOfAcknowledged((folded?.acknowledged ?? []).filter((delivery) => reads(delivery.message))),
    ];
    return { at, waits };
  });
  const openWaits = waitsOfAcknowledged(snapshot.acknowledged.filter((delivery) => reads(delivery.message)));
  const closedPerHour = closedWaits.map(({ at, waits }) => ({ at, count: waits.reduce((sum, one) => sum + waitCount(one), 0) }));
  const perHour = [...closedPerHour.slice(1), { at: now, count: waitCount(openWaits) }];
  return {
    count: [...closedPerHour, { count: waitCount(openWaits) }].reduce((sum, hour) => sum + hour.count, 0),
    medianMs: medianOfWaits([...closedWaits.flatMap(({ waits }) => waits), openWaits]),
    perHour,
  };
}

/**
 * The health at `now` from the snapshot: the hours it has not closed yet are
 * folded as a close would, then the rest of the events up to now. Stuck now
 * and in each hour count only the deliveries whose message `reads` keeps.
 * A ship `readsShip` leaves out is shown without its machine (decision 0034).
 */
export function healthFromSnapshot(
  snapshot: EventsAfter & { latest: LatestSnapshot; hours: readonly HourSnapshot[]; crews: HealthCrews },
  read: { now: Date; reads: (message: MessageParties) => boolean; readsShip: (shipId: ShipId) => boolean },
): Health {
  const { now, reads, readsShip } = read;
  const folded = foldedToNow(snapshot, now);
  const stuckNow = stuckNowOf(snapshot.crews, { fold: folded.fold, now, reads });
  return {
    stuck: shownStuck(stuckNow, { ships: snapshot.crews.ships, machines: snapshot.crews.machines.filter(({ shipId }) => readsShip(shipId)) }),
    stuckPerHour: stuckPerHourOf({ hours: snapshot.hours, folded: folded.hours, crews: snapshot.crews }, { now, stuckNow: stuckNow.length, reads }),
    acknowledged: acknowledgedOfSnapshot({ hours: snapshot.hours, folded: folded.hours, acknowledged: folded.acknowledged }, { now, reads }),
  };
}
