/**
 * The health reads (decision 0042, performance design section 6): from the
 * stuck snapshot and the events after it once the fleet has one, else
 * replayed from the fleet's records, writing nothing. Each part of the health
 * reads on its own, only what it answers (performance design, decision 2).
 */
import { ACKNOWLEDGED_HOURS, STUCK_TREND_HOURS, type FleetId, type ShipId } from '@aeolus-fleet/common';

import type { MessageParties } from '../registry/public.js';
import { acknowledgedOfSnapshot, foldedToNow, healthFromSnapshot, hourMarkOf, stuckNowOf, stuckPerHourOf, type HealthSnapshots } from './health-snapshot.js';
import { acknowledgedOf, acknowledgedSince, healthOf, healthSince, shownStuck, type Acknowledged, type Health, type HealthFacts, type HealthRecords, type StuckPlaceHealth } from './health.js';
import { stuckAt, stuckPerHour, type StuckDelivery } from './stuck.js';

const HOUR_MS = 60 * 60 * 1000;

interface HealthReadDeps {
  records: HealthRecords;
  snapshots: HealthSnapshots;
}

/** A health read at `now`, counting only the deliveries whose message `reads` keeps; a ship `readsShip` leaves out shows without its machine (decision 0034). */
interface HealthRead {
  fleetId: FleetId;
  now: Date;
  reads?: (message: MessageParties) => boolean;
  readsShip?: (shipId: ShipId) => boolean;
}

/** The closed hours a read of the last `hours` hours takes: those after the first mark it shows. */
function hoursSince(now: Date, hours: number): Date {
  return new Date(hourMarkOf(now).getTime() - hours * HOUR_MS);
}

/** Reads the fleet's whole health at `now`. */
export async function readHealthOf(deps: HealthReadDeps, read: HealthRead): Promise<Health> {
  const { fleetId, now, reads = () => true, readsShip = () => true } = read;
  const latest = await deps.snapshots.latest(fleetId);
  if (latest === undefined) {
    const [facts, acknowledged] = await Promise.all([deps.records.read(fleetId, healthSince(now)), deps.records.acknowledged(fleetId, acknowledgedSince(now))]);
    const deliveries = facts.deliveries.filter(({ senderId, recipient, claimedBy }) => reads({ senderId, recipient, claimedBy }));
    const machines = facts.machines.filter(({ shipId }) => readsShip(shipId));
    return healthOf({ ...facts, deliveries, machines }, { acknowledged: acknowledgedOf(acknowledged.filter((delivery) => reads(delivery.message)), now), now });
  }
  const [hours, after, crews, machines] = await Promise.all([
    deps.snapshots.hours(fleetId, hoursSince(now, STUCK_TREND_HOURS)),
    deps.snapshots.eventsAfter(fleetId, { seq: latest.fold.seq }),
    deps.snapshots.crews(fleetId, latest.hour),
    deps.snapshots.machines(fleetId),
  ]);
  return healthFromSnapshot({ latest, hours, ...after, crews: { ...crews, machines } }, { now, reads, readsShip });
}

/** What is stuck at `now`, with the ships it names. */
async function stuckNowWithCrews(deps: HealthReadDeps, read: HealthRead): Promise<{ stuck: StuckDelivery[]; crews: Pick<HealthFacts, 'ships'> }> {
  const { fleetId, now, reads = () => true } = read;
  const latest = await deps.snapshots.latest(fleetId);
  if (latest === undefined) {
    const facts = await deps.records.read(fleetId, healthSince(now));
    const deliveries = facts.deliveries.filter(({ senderId, recipient, claimedBy }) => reads({ senderId, recipient, claimedBy }));
    return { stuck: stuckAt({ ...facts, deliveries }, now), crews: facts };
  }
  const [after, crews] = await Promise.all([deps.snapshots.eventsAfter(fleetId, { seq: latest.fold.seq }), deps.snapshots.crews(fleetId, latest.hour)]);
  return { stuck: stuckNowOf(crews, { fold: foldedToNow({ latest, ...after }, now).fold, now, reads }), crews };
}

/** Reads the deliveries stuck at `now`. */
export async function readStuckNowOf(deps: HealthReadDeps, read: HealthRead): Promise<StuckDelivery[]> {
  return (await stuckNowWithCrews(deps, read)).stuck;
}

/** Reads the deliveries stuck at `now` by cause and place, each ship by name with the machine behind it. */
export async function readStuckPlacesOf(deps: HealthReadDeps, read: HealthRead): Promise<StuckPlaceHealth[]> {
  const { fleetId, readsShip = () => true } = read;
  const [{ stuck, crews }, machines] = await Promise.all([stuckNowWithCrews(deps, read), deps.snapshots.machines(fleetId)]);
  return shownStuck(stuck, { ships: crews.ships, machines: machines.filter(({ shipId }) => readsShip(shipId)) });
}

/** Reads how many deliveries were stuck at each hour of the last 7 days, oldest first, the last one now. */
export async function readStuckHistoryOf(deps: HealthReadDeps, read: HealthRead): Promise<{ at: Date; count: number }[]> {
  const { fleetId, now, reads = () => true } = read;
  const latest = await deps.snapshots.latest(fleetId);
  if (latest === undefined) {
    const facts = await deps.records.read(fleetId, healthSince(now));
    const deliveries = facts.deliveries.filter(({ senderId, recipient, claimedBy }) => reads({ senderId, recipient, claimedBy }));
    return stuckPerHour({ ...facts, deliveries }, now);
  }
  const [hours, after, crews] = await Promise.all([
    deps.snapshots.hours(fleetId, hoursSince(now, STUCK_TREND_HOURS)),
    deps.snapshots.eventsAfter(fleetId, { seq: latest.fold.seq }),
    deps.snapshots.crews(fleetId, latest.hour),
  ]);
  const folded = foldedToNow({ latest, ...after }, now);
  const stuckNow = stuckNowOf(crews, { fold: folded.fold, now, reads });
  return stuckPerHourOf({ hours, folded: folded.hours, crews }, { now, stuckNow: stuckNow.length, reads });
}

/** Reads the deliveries acknowledged in the 24 hours up to `now`. */
export async function readAcknowledgedOf(deps: HealthReadDeps, read: HealthRead): Promise<Acknowledged> {
  const { fleetId, now, reads = () => true } = read;
  const latest = await deps.snapshots.latest(fleetId);
  if (latest === undefined) {
    const acknowledged = await deps.records.acknowledged(fleetId, acknowledgedSince(now));
    return acknowledgedOf(acknowledged.filter((delivery) => reads(delivery.message)), now);
  }
  const [hours, after] = await Promise.all([deps.snapshots.hours(fleetId, hoursSince(now, ACKNOWLEDGED_HOURS)), deps.snapshots.eventsAfter(fleetId, { seq: latest.fold.seq })]);
  const folded = foldedToNow({ latest, ...after }, now);
  return acknowledgedOfSnapshot({ hours, folded: folded.hours, acknowledged: folded.acknowledged }, { now, reads });
}
