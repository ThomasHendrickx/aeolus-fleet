import { createIdGenerator } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startMaintenancePass } from './maintenance-pass.js';

const TASKS = ['tellOverdueDeliveries', 'closeHealthSnapshots', 'pruneHistory', 'sealStoredPayloads', 'rotateDataKeys', 'sendDueSchedules'];
const START = new Date('2026-11-10T12:00:00Z');
const NEXT_ATTEMPT = new Date('2026-11-10T12:01:00Z');
const MARKER = 'harmless-maintenance-marker';
const fleetId = createIdGenerator()('fleet');

/** In-memory task boundaries: one enumeration failure, then healthy on retry. */
function aMaintenancePass(failedTask?: string) {
  const attempted: string[] = [];
  const logs: { fields: unknown; message: string }[] = [];
  const told: Date[] = [];
  let hasFailed = false;
  const attempt = (task: string) => {
    attempted.push(task);
    if (task === failedTask && !hasFailed) {
      hasFailed = true;
      return Promise.reject(new Error(MARKER));
    }
    return Promise.resolve();
  };
  const options: Parameters<typeof startMaintenancePass>[0] = {
    useCases: {
      tellOverdueDeliveries: () => attempt('tellOverdueDeliveries'),
      closeHealthSnapshots: () => attempt('closeHealthSnapshots'),
      pruneHistory: () => attempt('pruneHistory'),
      sealStoredPayloads: () => attempt('sealStoredPayloads'),
      rotateDataKeys: () => attempt('rotateDataKeys'),
      sendDueSchedules: async () => {
        await attempt('sendDueSchedules');
        return { nextAttemptAt: NEXT_ATTEMPT };
      },
    },
    log: { warn: (fields, message) => { logs.push({ fields, message }); } },
    scheduleTimer: { told: (at) => { told.push(at); } },
    scheduleSendFailed: () => undefined,
    everyMs: 1_000,
  };
  return { options, attempted, logs, told };
}

beforeEach(() => { vi.useFakeTimers({ now: START }); });
afterEach(() => { vi.useRealTimers(); });

describe('independent maintenance tasks', () => {
  it.each(TASKS)('continues after %s fails before its fleet loop and retries next pass', async (failedTask) => {
    const pass = aMaintenancePass(failedTask);
    const running = startMaintenancePass(pass.options);

    try {
      await vi.advanceTimersByTimeAsync(1_000);

      expect(pass.attempted).toEqual(TASKS);
      expect(pass.logs).toEqual([{
        fields: { task: failedTask, reason: 'Unexpected failure', errorType: 'Error' },
        message: 'maintenance task failed: trying again next pass',
      }]);
      expect(JSON.stringify(pass.logs)).not.toContain(MARKER);
      expect(pass.told).toEqual(failedTask === 'sendDueSchedules' ? [] : [NEXT_ATTEMPT]);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(pass.attempted).toEqual([...TASKS, ...TASKS]);
      expect(pass.logs).toHaveLength(1);
      expect(pass.told).toEqual(failedTask === 'sendDueSchedules' ? [NEXT_ATTEMPT] : [NEXT_ATTEMPT, NEXT_ATTEMPT]);
    } finally {
      await running.stop();
    }
  });

  it('retains per-fleet recovery and the schedule timer fallback', async () => {
    const pass = aMaintenancePass();
    pass.options.useCases.closeHealthSnapshots = (onFleetError) => {
      pass.attempted.push('closeHealthSnapshots');
      onFleetError?.(fleetId, new Error(MARKER));
      return Promise.resolve();
    };
    const running = startMaintenancePass(pass.options);

    try {
      await vi.advanceTimersByTimeAsync(1_000);

      expect(pass.attempted).toEqual(TASKS);
      expect(pass.logs).toEqual([{
        fields: { fleetId, reason: 'Unexpected failure', errorType: 'Error' },
        message: 'the stuck snapshot failed to close an hour for a fleet: closing it again next pass',
      }]);
      expect(JSON.stringify(pass.logs)).not.toContain(MARKER);
      expect(pass.told).toEqual([NEXT_ATTEMPT]);
    } finally {
      await running.stop();
    }
  });
});
