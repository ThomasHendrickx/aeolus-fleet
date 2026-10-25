import { durationMs, type FleetId, type ShipId } from '@aeolus-fleet/common';

import { appliedLimits, type AppliedLimitsTx } from '../registry/public.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { cronSendTimesCloserThan, parseCron } from './cron.js';
import type { ScheduleRepository } from './ports.js';
import type { ScheduleTiming } from './schedule.js';

export interface ScheduleLimitsTx extends AppliedLimitsTx {
  schedules: Pick<ScheduleRepository, 'lockShipScheduleCount' | 'countOpenOfShip'>;
}

export type ScheduleLimitRefusal = DomainError<'SCHEDULE_INTERVAL_TOO_SHORT' | 'SCHEDULE_LIMIT_REACHED'>;

const SECOND_MS = 1000;

/**
 * Whether the ship may make one more schedule of this timing, in the
 * caller's unit of work, before it stores it (decision 0062, S12). First the
 * minimum interval: an every's duration, or a cron's shortest gap between two
 * send times over the next year read in UTC; a once has none. Then the
 * schedules per ship limit, counting the ship's active and paused schedules
 * under the ship's lock, held until the schedule is stored, so creations at
 * the limit never overshoot it. Without a limit, nothing is counted or locked.
 */
export async function withinScheduleLimits(tx: ScheduleLimitsTx, of: { fleetId: FleetId; shipId: ShipId; timing: ScheduleTiming; at: Date }): Promise<Result<undefined, ScheduleLimitRefusal>> {
  const { fleetId, shipId } = of;
  const limits = await appliedLimits(tx, fleetId);
  if (limits.minimumScheduleInterval !== null) {
    const interval = withinMinimumInterval(of.timing, { minimumSeconds: limits.minimumScheduleInterval, at: of.at });
    if (!interval.isOk) {
      return interval;
    }
  }
  if (limits.schedulesPerShip === null) {
    return ok(undefined);
  }
  await tx.schedules.lockShipScheduleCount(fleetId, shipId);
  if ((await tx.schedules.countOpenOfShip(fleetId, shipId)) < limits.schedulesPerShip) {
    return ok(undefined);
  }
  return refuse('SCHEDULE_LIMIT_REACHED', `The ship holds its fleet's limit of ${String(limits.schedulesPerShip)} schedules, active or paused: cancel one to make another`);
}

function withinMinimumInterval(timing: ScheduleTiming, rule: { minimumSeconds: number; at: Date }): Result<undefined, DomainError<'SCHEDULE_INTERVAL_TOO_SHORT'>> {
  const minimum = `The fleet's send times of a repeating schedule are at least ${String(rule.minimumSeconds)} seconds apart`;
  const minimumMs = rule.minimumSeconds * SECOND_MS;
  if (timing.kind === 'every') {
    const intervalMs = durationMs(timing.every) ?? 0;
    return intervalMs < minimumMs ? refuse('SCHEDULE_INTERVAL_TOO_SHORT', `${minimum}: every ${timing.every} is ${String(intervalMs / SECOND_MS)} seconds`) : ok(undefined);
  }
  if (timing.kind === 'cron') {
    const cron = parseCron(timing.cron);
    const closer = cron.isOk ? cronSendTimesCloserThan(cron.value, { after: rule.at, minimumMs }) : undefined;
    if (closer) {
      const apartSeconds = (closer.second.getTime() - closer.first.getTime()) / SECOND_MS;
      return refuse(
        'SCHEDULE_INTERVAL_TOO_SHORT',
        `${minimum}: cron ${timing.cron} sends ${String(apartSeconds)} seconds apart, at ${closer.first.toISOString()} and ${closer.second.toISOString()}`,
      );
    }
  }
  return ok(undefined);
}
