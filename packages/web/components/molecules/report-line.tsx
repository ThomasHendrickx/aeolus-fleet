import type { ListedShip, ReportState } from '@aeolus-fleet/common';
import { Activity, CirclePause, OctagonPause, type LucideIcon } from 'lucide-react';

import { classNames } from '../../lib/class-names';
import { fullDateTime } from '../../lib/relative-time';
import { REPORT_STATE_WORDS, REPORT_TONES, reportAge, reportedWhen, reportText } from '../../lib/report';

const ICONS: Record<ReportState, LucideIcon> = { working: Activity, blocked: OctagonPause, idle: CirclePause };

const TONE_TEXT = {
  active: 'text-tone-active-fg',
  waiting: 'text-tone-waiting-fg',
  ended: 'text-tone-ended-fg',
} as const;

/**
 * What a ship says it is doing (docs/design/png/ReportLine.png): the state's
 * icon and word in its tone, the note in the foreground, truncated, and when
 * it reported, muted: short in a row ("2 min"), in words on the ship page
 * ("reported 2 min ago"). "No report yet" before the crew reports. Never
 * colour alone: the icon and the word say the state.
 */
export function ReportLine({
  report,
  now,
  variant,
  testId,
}: {
  report: ListedShip['report'];
  now: Date;
  variant: 'row' | 'full';
  /** The test id of the line, by where it shows. */
  testId: string;
}) {
  const isFull = variant === 'full';
  const frame = classNames('flex min-w-0 items-center gap-1.5', isFull ? 'text-body' : 'text-meta');
  if (report === null) {
    return (
      <span data-testid={testId} data-state="none" className={classNames(frame, 'text-muted-foreground')}>
        No report yet
      </span>
    );
  }
  const Icon = ICONS[report.state];
  const tone = TONE_TEXT[REPORT_TONES[report.state]];
  const reportedAt = new Date(report.reportedAt);
  return (
    <span data-testid={testId} data-state={report.state} title={reportText(report)} className={frame}>
      <Icon aria-hidden className={classNames('size-(--size-icon-sm) shrink-0', tone)} />
      <span className={classNames('shrink-0 font-medium', tone)}>{REPORT_STATE_WORDS[report.state]}</span>
      {report.note === null ? null : <span className="min-w-0 truncate text-foreground">{report.note}</span>}
      <time
        dateTime={report.reportedAt}
        title={fullDateTime(reportedAt)}
        className="shrink-0 text-muted-foreground tabular-nums"
      >
        {isFull ? `· ${reportedWhen(reportedAt, now)}` : reportAge(reportedAt, now)}
      </time>
    </span>
  );
}
