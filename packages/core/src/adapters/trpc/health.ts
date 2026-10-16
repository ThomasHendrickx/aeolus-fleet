import type { Health } from '../../domain/shared/health.js';

/** The fleet's health with its times as ISO strings, as `healthOutputSchema` describes it. */
export function describedHealth(health: Health) {
  return {
    stuck: health.stuck.map(({ place, oldestSince, ...counted }) => ({
      ...counted,
      oldestSince: oldestSince.toISOString(),
      place: place.kind === 'type' ? place : { ...place, machine: place.machine === null ? null : { ...place.machine, lastSeenAt: place.machine.lastSeenAt?.toISOString() ?? null } },
    })),
    stuckPerHour: health.stuckPerHour.map(({ at, count }) => ({ at: at.toISOString(), count })),
    acknowledged: health.acknowledged,
  };
}
