import { reportDetailsBytes, type ListedShip, type ReportDetails, type ReportState } from '@aeolus-fleet/common';

import { relativeTime } from './relative-time';

const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A report state as the console words it. */
export const REPORT_STATE_WORDS: Record<ReportState, string> = { working: 'Working', blocked: 'Blocked', idle: 'Idle' };

/** A report state's tone family (docs/design/conventions.md, "Colour"): working is active, blocked waits, idle has ended. */
export const REPORT_TONES = { working: 'active', blocked: 'waiting', idle: 'ended' } as const satisfies Record<ReportState, string>;

/**
 * How long ago a crew reported, short, for a row (docs/design/png/ReportLine.png):
 * "34 s", "2 min", "3 h", then the date.
 */
export function reportAge(reportedAt: Date, now: Date): string {
  const elapsedMs = Math.max(0, now.getTime() - reportedAt.getTime());
  if (elapsedMs < MINUTE_MS) {
    return `${String(Math.floor(elapsedMs / SECOND_MS))} s`;
  }
  if (elapsedMs < HOUR_MS) {
    return `${String(Math.floor(elapsedMs / MINUTE_MS))} min`;
  }
  if (elapsedMs < DAY_MS) {
    return `${String(Math.floor(elapsedMs / HOUR_MS))} h`;
  }
  return relativeTime(reportedAt, now);
}

/** When a crew reported, for the ship page: "reported 2 min ago", "reported just now". */
export function reportedWhen(reportedAt: Date, now: Date): string {
  const when = relativeTime(reportedAt, now);
  return `reported ${when === 'Just now' ? 'just now' : when}`;
}

/** The whole report in one line, for a title or a copy: "Blocked: waiting for review". */
export function reportText(report: NonNullable<ListedShip['report']>): string {
  const word = REPORT_STATE_WORDS[report.state];
  return report.note === null ? word : `${word}: ${report.note}`;
}

/** A report's details shown raw (decision 0028): their JSON, indented. */
export function reportDetailsJson(details: ReportDetails): string {
  return JSON.stringify(details, null, 2);
}

/** What the raw details are, for the code block's label: "JSON · 50 bytes", counted as the server counts them. */
export function reportDetailsLabel(details: ReportDetails): string {
  return `JSON · ${String(reportDetailsBytes(details))} bytes`;
}
