import type { FleetId } from '@aeolus-fleet/common';

import { failureForLog, type LoggedFailure } from './adapters/prisma/failure-log.js';
import { repeatPass, type RepeatingPass } from './repeating-pass.js';
import type { ScheduleTimer } from './schedule-timer.js';
import type { UseCases } from './wiring.js';

type MaintenanceUseCases = Pick<UseCases,
  'tellOverdueDeliveries' | 'closeHealthSnapshots' | 'pruneHistory' | 'sealStoredPayloads' | 'rotateDataKeys' | 'sendDueSchedules'
>;

/** The app's periodic maintenance, with the same task boundaries in memory and in production. */
export function startMaintenancePass(options: {
  useCases: MaintenanceUseCases;
  log: { warn(fields: LoggedFailure & { fleetId?: FleetId; task?: string }, message: string): void };
  scheduleTimer: Pick<ScheduleTimer, 'told'>;
  scheduleSendFailed: (fleetId: FleetId, error: unknown) => void;
  everyMs: number;
}): RepeatingPass {
  const { useCases, scheduleTimer, scheduleSendFailed } = options;
  // One pass, every 30 seconds: the clocks, then the stuck snapshot's close,
  // then the pruning of finished history (decision 0066), then the sealing of
  // what a sealing fleet stored plain and the data keys by age (decision
  // 0068), then whatever
  // schedule is due that a lost timer missed (decision 0062, S14).
  // Each failure is logged on its own, so one never keeps another from running.
  return repeatPass({
    pass: async () => {
      const tasks = {
        tellOverdueDeliveries: () => useCases.tellOverdueDeliveries(),
        closeHealthSnapshots: () => useCases.closeHealthSnapshots((fleetId, error) => {
          options.log.warn({ ...failureForLog(error), fleetId }, 'the stuck snapshot failed to close an hour for a fleet: closing it again next pass');
        }),
        pruneHistory: () => useCases.pruneHistory((fleetId, error) => {
          options.log.warn({ ...failureForLog(error), fleetId }, 'the pruning pass failed for a fleet: pruning it again next hour');
        }),
        sealStoredPayloads: () => useCases.sealStoredPayloads((fleetId, error) => {
          options.log.warn({ ...failureForLog(error), fleetId }, 'the sealing pass failed for a fleet: sealing it again next pass');
        }),
        rotateDataKeys: () => useCases.rotateDataKeys((fleetId, error) => {
          options.log.warn({ ...failureForLog(error), fleetId }, 'the data key rotation failed for a fleet: rotating it again next pass');
        }),
        sendDueSchedules: async () => {
          const { nextAttemptAt } = await useCases.sendDueSchedules(scheduleSendFailed);
          if (nextAttemptAt) {
            scheduleTimer.told(nextAttemptAt);
          }
        },
      };
      for (const [task, run] of Object.entries(tasks)) {
        try {
          await run();
        } catch (error) {
          options.log.warn({ ...failureForLog(error), task }, 'maintenance task failed: trying again next pass');
        }
      }
    },
    everyMs: options.everyMs,
    onError: (error) => {
      options.log.warn(failureForLog(error), 'maintenance pass failed: passing again shortly');
    },
  });
}
