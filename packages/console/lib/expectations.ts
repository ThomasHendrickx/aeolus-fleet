import type { ExpectationsOutput, FleetId, ReportTask } from '@aeolus-fleet/common';

import { clockTime, shortDateTime } from './relative-time';
import { reportTaskLabel } from './report-task';

/**
 * A ship's expectations as its page's read-only Expectations row reads them
 * (docs/design/monitoring, 4.7 and 4.8): "Report changes within 60 min",
 * "Task PR #1391 done by 18:00", the task's title holding its whole URL or
 * ids. A task done by lapses once the report names another task, or none.
 * Nothing when none is set.
 */
export type ExpectationLine = { key: 'reportChangesWithin'; text: string } | { key: 'taskDoneBy'; text: string; title: string; isLapsed: boolean };

export function expectationLines(
  { reportChangesWithin, taskDoneBy }: ExpectationsOutput,
  { reportTask, now, viewerFleetId }: { reportTask: ReportTask | null; now: Date; viewerFleetId: FleetId | undefined },
): ExpectationLine[] {
  const lines: ExpectationLine[] = [];
  if (reportChangesWithin) {
    lines.push({ key: 'reportChangesWithin', text: `Report changes within ${String(reportChangesWithin.minutes)} min` });
  }
  if (taskDoneBy) {
    const { label, title } = reportTaskLabel(taskDoneBy.task, viewerFleetId);
    const isLapsed = reportTask === null || !isSameJson(reportTask, taskDoneBy.task);
    const text = `Task ${label} done by ${dueTime(new Date(taskDoneBy.doneBy), now)}`;
    lines.push({ key: 'taskDoneBy', text: isLapsed ? `${text} · lapsed` : text, title, isLapsed });
  }
  return lines;
}

/** "18:00" on the day it is now, "2 Nov, 09:30" on another. */
function dueTime(at: Date, now: Date): string {
  return at.toDateString() === now.toDateString() ? clockTime(at) : shortDateTime(at);
}

/** Two tasks are the same task when their kind and every field are equal (docs/design/monitoring, 4.2), whatever order their keys came in. */
function isSameJson(first: unknown, second: unknown): boolean {
  if (Array.isArray(first) || Array.isArray(second)) {
    return Array.isArray(first) && Array.isArray(second) && first.length === second.length && first.every((item, index) => isSameJson(item, second[index]));
  }
  if (typeof first === 'object' && first !== null && typeof second === 'object' && second !== null) {
    const firstEntries = Object.entries(first);
    const secondRecord = new Map(Object.entries(second));
    return firstEntries.length === secondRecord.size && firstEntries.every(([key, value]) => secondRecord.has(key) && isSameJson(value, secondRecord.get(key)));
  }
  return first === second;
}
