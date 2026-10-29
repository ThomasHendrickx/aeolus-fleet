import type { CompanyKeyUnavailableReason, FleetSealingRepository } from '../messaging/public.js';
import type { ReadReachOf } from '../registry/public.js';
import type { Caller } from './caller.js';
import type { Clock } from './clock.js';
import { readHealthOf } from './health-read.js';
import type { HealthSnapshots } from './health-snapshot.js';
import type { Health, HealthRecords } from './health.js';

/** The fleet's health, and whether a sealed fleet's company key refuses it, why and since when (decision 0068, B11): none while it answers. */
export type FleetHealth = Health & { keyUnavailable: { reason: CompanyKeyUnavailableReason; since: Date } | null };

export type ReadHealth = (caller: Caller) => Promise<FleetHealth>;

/**
 * Use case: the health of the caller's fleet (decision 0042), for the
 * console's Health: its stuck deliveries by cause and place, the trend over
 * the last 7 days and what was acknowledged in the last 24 hours, counting
 * only the deliveries whose message the caller reads, and naming the machine
 * only behind a ship the caller reads (decision 0034). A sealed fleet whose
 * company key is not reachable delivers nothing it stores, so its health says
 * so (decision 0068). The caller's scope (fleet:read) is checked before this
 * runs.
 */
export function createReadHealth(deps: { health: HealthRecords; snapshots: HealthSnapshots; clock: Clock; readReach: ReadReachOf; sealings: Pick<FleetSealingRepository, 'find'> }): ReadHealth {
  return async (caller) => {
    const [reach, sealing] = await Promise.all([deps.readReach(caller), deps.sealings.find(caller.fleetId)]);
    const health = await readHealthOf({ records: deps.health, snapshots: deps.snapshots }, {
      fleetId: caller.fleetId,
      now: deps.clock.now(),
      reach,
    });
    const availability = sealing?.keyAvailability;
    return { ...health, keyUnavailable: availability === undefined || availability.isAvailable ? null : { reason: availability.reason, since: availability.since } };
  };
}
