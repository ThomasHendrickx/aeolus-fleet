import type { ExpectationsOutput, FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { expectationLines } from './expectations';

// The ship page's read-only Expectations row (docs/design/monitoring, 4.7
// and 4.8): what holds, in words, as the mockup reads it.

const VIEWER_FLEET: FleetId = 'flt_01m66p4k2v9qz8f7x3n5c17acm';
const PULL_REQUEST = { kind: 'url', url: 'https://github.com/ThomasHendrickx/aeolus-fleet/pull/1391' };
const SET_BY = { kind: 'ship' as const, shipId: 'shp_01m66p4k2v9qz8f7x3n5c1r1x0' as const };
const NOW = new Date(2026, 9, 31, 15, 0);
const SIX_PM_TODAY = new Date(2026, 9, 31, 18, 0);

function both(doneBy = SIX_PM_TODAY): ExpectationsOutput {
  return {
    reportChangesWithin: { minutes: 60, setBy: SET_BY, setAt: NOW.toISOString() },
    taskDoneBy: { task: PULL_REQUEST, doneBy: doneBy.toISOString(), setBy: SET_BY, setAt: NOW.toISOString() },
  };
}

describe('expectationLines: the Expectations row on the ship page', () => {
  it('reads report changes within its minutes, and the task by its label done by its time today', () => {
    expect(expectationLines(both(), { reportTask: PULL_REQUEST, now: NOW, viewerFleetId: VIEWER_FLEET })).toEqual([
      { key: 'reportChangesWithin', text: 'Report changes within 60 min' },
      { key: 'taskDoneBy', text: 'Task PR #1391 done by 18:00', title: PULL_REQUEST.url, isLapsed: false },
    ]);
  });

  it('gives the day too when the task is due another day', () => {
    expect(expectationLines(both(new Date(2026, 10, 2, 9, 30)), { reportTask: PULL_REQUEST, now: NOW, viewerFleetId: VIEWER_FLEET })[1]).toMatchObject({ text: 'Task PR #1391 done by 2 Nov, 09:30' });
  });

  it('shows the task done by as lapsed once the report names another task, or none', () => {
    const otherTask = { kind: 'url', url: 'https://github.com/ThomasHendrickx/aeolus-fleet/issues/1407' };

    expect(expectationLines(both(), { reportTask: otherTask, now: NOW, viewerFleetId: VIEWER_FLEET })[1]).toEqual({
      key: 'taskDoneBy',
      text: 'Task PR #1391 done by 18:00 · lapsed',
      title: PULL_REQUEST.url,
      isLapsed: true,
    });
    expect(expectationLines(both(), { reportTask: null, now: NOW, viewerFleetId: VIEWER_FLEET })[1]).toMatchObject({ isLapsed: true });
  });

  it('takes the same task with its fields in another order as the task it was set for', () => {
    expect(expectationLines(both(), { reportTask: { url: PULL_REQUEST.url, kind: 'url' }, now: NOW, viewerFleetId: VIEWER_FLEET })[1]).toMatchObject({ isLapsed: false });
  });

  it('reads only what is set, and nothing when none is', () => {
    expect(expectationLines({ ...both(), taskDoneBy: null }, { reportTask: null, now: NOW, viewerFleetId: VIEWER_FLEET })).toEqual([
      { key: 'reportChangesWithin', text: 'Report changes within 60 min' },
    ]);
    expect(expectationLines({ reportChangesWithin: null, taskDoneBy: null }, { reportTask: null, now: NOW, viewerFleetId: VIEWER_FLEET })).toEqual([]);
  });
});
