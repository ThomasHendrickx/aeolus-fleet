/**
 * The health reads (decision 0042, performance design section 6): from the
 * stuck snapshot and the events after it once the fleet has one, else
 * replayed from the fleet's records, writing nothing. Each part of the health
 * reads on its own, only what it answers (performance design, decision 2).
 */
import { ACKNOWLEDGED_HOURS, STUCK_TREND_HOURS, type FleetId } from '@aeolus-fleet/common';

import { readsMessage, readsShip, type MessageParties, type ReadReach } from '../registry/public.js';
import { acknowledgedOfSnapshot, foldedToNow, healthFromSnapshot, hourMarkOf, stuckNowOf, stuckPerHourOf, touchedBy, type HealthSnapshots } from './health-snapshot.js';
import { acknowledgedOf, acknowledgedSince, healthOf, healthSince, shownStuck, type Acknowledged, type Health, type HealthFacts, type HealthRecords, type StuckPlaceHealth } from './health.js';
import { stuckAt, stuckPerHour, type StuckDelivery } from './stuck.js';

const HOUR_MS = 60 * 60 * 1000;

interface HealthReadDeps {
  records: HealthRecords;
  snapshots: HealthSnapshots;
}

/** A health read at `now`, counting only the deliveries whose message `reach` reads; a ship it does not read shows without its machine (decision 0034). Every ship when no reach is given. */
interface HealthRead {
  fleetId: FleetId;
  now: Date;
  reach?: ReadReach;
}

const EVERY: ReadReach = { kind: 'every' };

/** Whether the read counts a message's deliveries. */
function readsOf(read: HealthRead): (message: MessageParties) => boolean {
  const { reach = EVERY } = read;
  return (message) => readsMessage(reach, message);
}

/** The closed hours a read of the last `hours` hours takes: those after the first mark it shows. */
function hoursSince(now: Date, hours: number): Date {
  return new Date(hourMarkOf(now).getTime() - hours * HOUR_MS);
}

/** Reads the fleet's whole health at `now`. */
export async function readHealthOf(deps: HealthReadDeps, read: HealthRead): Promise<Health> {
  const { fleetId, now, reach = EVERY } = read;
  const reads = readsOf(read);
  const latest = await deps.snapshots.latest(fleetId);
  if (latest === undefined) {
    const [facts, acknowledged] = await Promise.all([deps.records.read(fleetId, healthSince(now)), deps.records.acknowledged(fleetId, acknowledgedSince(now))]);
    const deliveries = facts.deliveries.filter(({ senderId, recipient, claimedBy }) => reads({ senderId, recipient, claimedBy }));
    const machines = facts.machines.filter(({ shipId }) => readsShip(reach, shipId));
    return healthOf({ ...facts, deliveries, machines }, { acknowledged: acknowledgedOf(acknowledged.filter((delivery) => reads(delivery.message)), now), now });
  }
  const [hours, after, crews, machines] = await Promise.all([
    deps.snapshots.hours(fleetId, hoursSince(now, STUCK_TREND_HOURS)),
    deps.snapshots.eventsAfter(fleetId, { seq: latest.fold.seq }),
    deps.snapshots.crews(fleetId, latest.hour),
    deps.snapshots.machines(fleetId),
  ]);
  return healthFromSnapshot({ latest, hours, ...after, crews: { ...crews, machines } }, { now, reads, readsShip: (shipId) => readsShip(reach, shipId) });
}

/** What is stuck at `now`, with the ships it names. */
async function stuckNowWithCrews(deps: HealthReadDeps, read: HealthRead): Promise<{ stuck: StuckDelivery[]; crews: Pick<HealthFacts, 'ships'> }> {
  const { fleetId, now } = read;
  const reads = readsOf(read);
  const latest = await deps.snapshots.latest(fleetId);
  if (latest === undefined) {
    const facts = await deps.records.read(fleetId, healthSince(now));
    const deliveries = facts.deliveries.filter(({ senderId, recipient, claimedBy }) => reads({ senderId, recipient, claimedBy }));
    return { stuck: stuckAt({ ...facts, deliveries }, now), crews: facts };
  }
  const { fold } = foldedToNow({ latest, ...(await deps.snapshots.eventsAfter(fleetId, { seq: latest.fold.seq })) }, now);
  const crews = await deps.snapshots.crewsTouching(fleetId, { since: latest.hour, touched: touchedBy(fold.deliveries) });
  return { stuck: stuckNowOf(crews, { fold, now, reads }), crews };
}

/** Reads the deliveries stuck at `now`. */
export async function readStuckNowOf(deps: HealthReadDeps, read: HealthRead): Promise<StuckDelivery[]> {
  return (await stuckNowWithCrews(deps, read)).stuck;
}

/** Reads the deliveries stuck at `now` by cause and place, each ship by name with the machine behind it. */
export async function readStuckPlacesOf(deps: HealthReadDeps, read: HealthRead): Promise<StuckPlaceHealth[]> {
  const { fleetId, reach = EVERY } = read;
  const [{ stuck, crews }, machines] = await Promise.all([stuckNowWithCrews(deps, read), deps.snapshots.machines(fleetId)]);
  return shownStuck(stuck, { ships: crews.ships, machines: machines.filter(({ shipId }) => readsShip(reach, shipId)) });
}

/** Reads how many deliveries were stuck at each hour of the last 7 days, oldest first, the last one now. */
export async function readStuckHistoryOf(deps: HealthReadDeps, read: HealthRead): Promise<{ at: Date; count: number }[]> {
  const { fleetId, now, reach = EVERY } = read;
  const reads = readsOf(read);
  const latest = await deps.snapshots.latest(fleetId);
  if (latest === undefined) {
    const facts = await deps.records.read(fleetId, healthSince(now));
    const deliveries = facts.deliveries.filter(({ senderId, recipient, claimedBy }) => reads({ senderId, recipient, claimedBy }));
    return stuckPerHour({ ...facts, deliveries }, now);
  }
  const [hours, after] = await Promise.all([
    deps.snapshots.stuckCounts(fleetId, { since: hoursSince(now, STUCK_TREND_HOURS), reach }),
    deps.snapshots.eventsAfter(fleetId, { seq: latest.fold.seq }),
  ]);
  const folded = foldedToNow({ latest, ...after }, now);
  // The hours the pass has not closed yet are counted here too, so their open deliveries are touched as well.
  const deliveries = [folded.fold, ...folded.hours.map((hour) => hour.fold)].flatMap((fold) => fold.deliveries);
  const crews = await deps.snapshots.crewsTouching(fleetId, { since: latest.hour, touched: touchedBy(deliveries) });
  const stuckNow = stuckNowOf(crews, { fold: folded.fold, now, reads });
  return stuckPerHourOf({ hours, folded: folded.hours, crews }, { now, stuckNow: stuckNow.length, reads });
}

/** Reads the deliveries acknowledged in the 24 hours up to `now`. */
export async function readAcknowledgedOf(deps: HealthReadDeps, read: HealthRead): Promise<Acknowledged> {
  const { fleetId, now, reach = EVERY } = read;
  const reads = readsOf(read);
  const latest = await deps.snapshots.latest(fleetId);
  if (latest === undefined) {
    const acknowledged = await deps.records.acknowledged(fleetId, acknowledgedSince(now));
    return acknowledgedOf(acknowledged.filter((delivery) => reads(delivery.message)), now);
  }
  const [hours, after] = await Promise.all([
    deps.snapshots.acknowledgedWaits(fleetId, { since: hoursSince(now, ACKNOWLEDGED_HOURS), reach }),
    deps.snapshots.eventsAfter(fleetId, { seq: latest.fold.seq }),
  ]);
  const folded = foldedToNow({ latest, ...after }, now);
  return acknowledgedOfSnapshot({ hours, folded: folded.hours, acknowledged: folded.acknowledged }, { now, reads });
}
