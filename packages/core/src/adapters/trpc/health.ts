import type { Acknowledged, Health, StuckPlaceHealth } from '../../domain/shared/health.js';

/** The stuck places with their times as ISO strings, as `stuckOutputSchema` describes them. */
export function describedStuck(stuck: readonly StuckPlaceHealth[]) {
  return stuck.map(({ place, oldestSince, deliveries, ...counted }) => ({
    ...counted,
    oldestSince: oldestSince.toISOString(),
    deliveries: deliveries.map(({ since, ...delivery }) => ({ ...delivery, since: since.toISOString() })),
    place: place.kind === 'type' ? place : { ...place, machine: place.machine === null ? null : { ...place.machine, lastSeenAt: place.machine.lastSeenAt?.toISOString() ?? null } },
  }));
}

/** Counts at hours with their times as ISO strings. */
export function describedPerHour(perHour: readonly { at: Date; count: number }[]) {
  return perHour.map(({ at, count }) => ({ at: at.toISOString(), count }));
}

/** The acknowledged with its hours as ISO strings, as `acknowledgedSchema` describes it. */
export function describedAcknowledged(acknowledged: Acknowledged) {
  return { ...acknowledged, perHour: describedPerHour(acknowledged.perHour) };
}

/** The fleet's health with its times as ISO strings, as `healthOutputSchema` describes it. */
export function describedHealth(health: Health) {
  return { stuck: describedStuck(health.stuck), stuckPerHour: describedPerHour(health.stuckPerHour), acknowledged: describedAcknowledged(health.acknowledged) };
}
