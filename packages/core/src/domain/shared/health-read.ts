/**
 * The health reads (decision 0042, performance design section 6): from the
 * stuck snapshot and the events after it once the fleet has one, else
 * replayed from the fleet's records, writing nothing.
 */
import { STUCK_TREND_HOURS, type FleetId, type ShipId } from '@aeolus-fleet/common';

import type { MessageParties } from '../registry/public.js';
import { healthFromSnapshot, hourMarkOf, type HealthSnapshots } from './health-snapshot.js';
import { acknowledgedOf, acknowledgedSince, healthOf, healthSince, type Health, type HealthRecords } from './health.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Reads the fleet's health at `now`, counting only the deliveries whose
 * message `reads` keeps, every one without it. A ship `readsShip` leaves out
 * is shown by name only, without the machine behind it (decision 0034).
 */
export async function readHealthOf(
  deps: { records: HealthRecords; snapshots: HealthSnapshots },
  read: { fleetId: FleetId; now: Date; reads?: (message: MessageParties) => boolean; readsShip?: (shipId: ShipId) => boolean },
): Promise<Health> {
  const { fleetId, now, reads = () => true, readsShip = () => true } = read;
  const latest = await deps.snapshots.latest(fleetId);
  if (latest === undefined) {
    const [facts, acknowledged] = await Promise.all([deps.records.read(fleetId, healthSince(now)), deps.records.acknowledged(fleetId, acknowledgedSince(now))]);
    const deliveries = facts.deliveries.filter(({ senderId, recipient, claimedBy }) => reads({ senderId, recipient, claimedBy }));
    const machines = facts.machines.filter(({ shipId }) => readsShip(shipId));
    return healthOf({ ...facts, deliveries, machines }, { acknowledged: acknowledgedOf(acknowledged.filter((delivery) => reads(delivery.message)), now), now });
  }
  const [hours, after, crews] = await Promise.all([
    deps.snapshots.hours(fleetId, new Date(hourMarkOf(now).getTime() - STUCK_TREND_HOURS * HOUR_MS)),
    deps.snapshots.eventsAfter(fleetId, latest.fold.seq),
    deps.snapshots.crews(fleetId, latest.hour),
  ]);
  return healthFromSnapshot({ latest, hours, ...after, crews }, { now, reads, readsShip });
}
