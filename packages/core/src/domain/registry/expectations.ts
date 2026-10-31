/**
 * Expectations on a ship (decision 0071, docs/design/monitoring 4.7): what
 * its owner, or a ship the fleet's rules let manage it, expects of it,
 * standing, at most one of each: its report changes within some minutes,
 * and a task done by a time. Each keeps who set it and when. Core holds
 * them and compares nothing; the watch compares them and tells. They stay
 * through a release and a recrew; a retire removes them.
 */
import { REPORT_CHANGES_WITHIN_MAX_MINUTES, REPORT_CHANGES_WITHIN_MIN_MINUTES, type ExpectationSetter, type FleetId, type ReportTask, type ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import { isSameTask, reportTask, type ReportTaskRefusal } from './report-task.js';
import type { Ship } from './ship.js';

/** The report is expected to change within `minutes`, while it says working or blocked. */
export interface ReportChangesWithin {
  minutes: number;
  setBy: ExpectationSetter;
  setAt: Date;
}

/** The task is expected done by `doneBy`, while the report names that task. */
export interface TaskDoneBy {
  task: ReportTask;
  doneBy: Date;
  setBy: ExpectationSetter;
  setAt: Date;
}

/** What holds on a ship now; each null while not set. */
export interface ShipExpectations {
  reportChangesWithin: ReportChangesWithin | null;
  taskDoneBy: TaskDoneBy | null;
}

/** A ship's expectations as they are kept. */
export interface Expectations extends ShipExpectations {
  fleetId: FleetId;
  shipId: ShipId;
}

export const NO_EXPECTATIONS: ShipExpectations = { reportChangesWithin: null, taskDoneBy: null };

/** Left out, an expectation stays as it is; null clears it. */
export interface ExpectationsChange {
  reportChangesWithin?: number | null;
  taskDoneBy?: { task: ReportTask; doneBy: Date } | null;
}

export type SetExpectationsRefusal = DomainError<'SHIP_ALREADY_RETIRED' | 'INVALID_EXPECTATIONS'> | ReportTaskRefusal;

/** Who sets an expectation, as decision 0057 names an actor: an account by its id only. */
export function setterOf(caller: Caller): ExpectationSetter {
  switch (caller.kind) {
    case 'account':
      return { kind: 'account', accountId: caller.accountId };
    case 'installation':
      return { kind: 'installation' };
    case 'operator':
    case 'viewer':
    case 'agent':
    case 'person':
    case 'app':
    case 'plugin':
      return { kind: 'ship', shipId: caller.shipId };
  }
}

/**
 * Sets a ship's expectations: refused on a retired ship, a bad minutes or a
 * task that does not check out, with nothing changed. An expectation that
 * changes is the setter's from now; one left out or set the same keeps who
 * set it and when. A change writes ExpectationsSet on the ship, caused by the
 * setter, with what holds after; nothing changed writes nothing. `kept` is
 * null once none holds.
 */
export function setExpectations(
  ship: Ship,
  input: { current: Expectations | undefined; change: ExpectationsChange; setter: ExpectationSetter; at: Date; actor: Actor },
): Result<{ kept: Expectations | null; events: NewEvent[] }, SetExpectationsRefusal> {
  const { current, change, setter, at, actor } = input;
  if (ship.retiredAt !== null) {
    return refuse('SHIP_ALREADY_RETIRED', `${ship.name} is retired: it holds no expectations`);
  }
  const minutes = change.reportChangesWithin;
  if (minutes !== undefined && minutes !== null && !isReportChangesWithin(minutes)) {
    return refuse(
      'INVALID_EXPECTATIONS',
      `Report changes within is a whole number of minutes from ${String(REPORT_CHANGES_WITHIN_MIN_MINUTES)} to ${String(REPORT_CHANGES_WITHIN_MAX_MINUTES)}`,
    );
  }
  if (change.taskDoneBy) {
    const checked = reportTask(change.taskDoneBy.task);
    if (!checked.isOk) {
      return checked;
    }
  }

  const before = current ?? NO_EXPECTATIONS;
  const reportChangesWithin =
    minutes === undefined || minutes === (before.reportChangesWithin?.minutes ?? null)
      ? before.reportChangesWithin
      : minutes === null
        ? null
        : { minutes, setBy: setter, setAt: at };
  const doneBy = change.taskDoneBy;
  const taskDoneBy =
    doneBy === undefined || isSameTaskDoneBy(before.taskDoneBy, doneBy) ? before.taskDoneBy : doneBy === null ? null : { ...doneBy, setBy: setter, setAt: at };
  if (reportChangesWithin === before.reportChangesWithin && taskDoneBy === before.taskDoneBy) {
    return ok({ kept: current ?? null, events: [] });
  }
  return ok({
    kept: reportChangesWithin === null && taskDoneBy === null ? null : { fleetId: ship.fleetId, shipId: ship.id, reportChangesWithin, taskDoneBy },
    events: [
      {
        fleetId: ship.fleetId,
        type: 'ExpectationsSet',
        occurredAt: at,
        actor,
        shipId: ship.id,
        details: { reportChangesWithin: reportChangesWithin?.minutes ?? null, taskDoneBy: taskDoneBy?.doneBy.toISOString() ?? null, taskKind: taskDoneBy?.task.kind ?? null },
      },
    ],
  });
}

function isReportChangesWithin(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= REPORT_CHANGES_WITHIN_MIN_MINUTES && minutes <= REPORT_CHANGES_WITHIN_MAX_MINUTES;
}

function isSameTaskDoneBy(held: TaskDoneBy | null, change: { task: ReportTask; doneBy: Date } | null): boolean {
  return held === null || change === null ? held === change : isSameTask(held.task, change.task) && held.doneBy.getTime() === change.doneBy.getTime();
}
