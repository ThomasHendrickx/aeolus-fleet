import { describe, expect, it } from 'vitest';

import { REPORT_CHANGES_WITHIN_MAX_MINUTES, REPORT_CHANGES_WITHIN_MIN_MINUTES, setExpectationsInputSchema } from './expectations.js';

// What fleet.setExpectations takes (docs/design/monitoring, 4.7): standing
// expectations on a ship, report changes within 5 to 10080 minutes and a
// task done by a time. Left out, one stays as it is; null clears it.

const SHIP_ID = 'shp_01m66p4k2v9qz8f7x3n5c14ftc';
const TASK = { kind: 'url', url: 'https://github.com/ThomasHendrickx/aeolus-fleet/pull/1391' };

describe('setExpectationsInputSchema (docs/design/monitoring, 4.7)', () => {
  it('takes report changes within 5 to 10080 minutes', () => {
    expect([REPORT_CHANGES_WITHIN_MIN_MINUTES, REPORT_CHANGES_WITHIN_MAX_MINUTES]).toEqual([5, 10080]);
    for (const minutes of [5, 60, 10080]) {
      expect(setExpectationsInputSchema.safeParse({ shipId: SHIP_ID, reportChangesWithin: minutes }).success).toBe(true);
    }
  });

  it('refuses report changes within fewer than 5 minutes, more than 10080, or part of a minute', () => {
    for (const minutes of [4, 10081, 7.5]) {
      expect(setExpectationsInputSchema.safeParse({ shipId: SHIP_ID, reportChangesWithin: minutes }).success).toBe(false);
    }
  });

  it('takes a task done by a time, with the task it is set for', () => {
    expect(setExpectationsInputSchema.parse({ shipId: SHIP_ID, taskDoneBy: { task: TASK, doneBy: '2026-10-31T18:00:00Z' } })).toEqual({
      shipId: SHIP_ID,
      taskDoneBy: { task: TASK, doneBy: '2026-10-31T18:00:00Z' },
    });
  });

  it('refuses a task done by with no time or no task', () => {
    expect(setExpectationsInputSchema.safeParse({ shipId: SHIP_ID, taskDoneBy: { task: TASK } }).success).toBe(false);
    expect(setExpectationsInputSchema.safeParse({ shipId: SHIP_ID, taskDoneBy: { doneBy: '2026-10-31T18:00:00Z' } }).success).toBe(false);
  });

  it('takes null to clear either, and either left out', () => {
    expect(setExpectationsInputSchema.parse({ shipId: SHIP_ID, reportChangesWithin: null, taskDoneBy: null })).toEqual({ shipId: SHIP_ID, reportChangesWithin: null, taskDoneBy: null });
    expect(setExpectationsInputSchema.parse({ shipId: SHIP_ID })).toEqual({ shipId: SHIP_ID });
  });
});
