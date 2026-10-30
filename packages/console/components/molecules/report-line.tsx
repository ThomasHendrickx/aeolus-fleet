import type { FleetId, ListedShip, ReportState, ReportTask } from '@aeolus-fleet/common';
import { Activity, CircleDot, CircleHelp, CirclePause, GitPullRequest, Link, Mail, OctagonPause, type LucideIcon } from 'lucide-react';

import { classNames } from '@aeolus-fleet/common/header';
import { fullDateTime } from '../../lib/relative-time';
import { REPORT_STATE_WORDS, REPORT_TONES, reportAge, reportChangedWhen, reportedWhen, reportText } from '../../lib/report';
import { reportStepText, reportTaskLabel, type ReportTaskLabel } from '../../lib/report-task';

const ICONS: Record<ReportState, LucideIcon> = { working: Activity, blocked: OctagonPause, idle: CirclePause };

const TASK_ICONS: Record<ReportTaskLabel['icon'], LucideIcon> = {
  pullRequest: GitPullRequest,
  issue: CircleDot,
  link: Link,
  message: Mail,
  unknown: CircleHelp,
};

const TONE_TEXT = {
  active: 'text-tone-active-fg',
  waiting: 'text-tone-waiting-fg',
  ended: 'text-tone-ended-fg',
} as const;

type Report = NonNullable<ListedShip['report']>;

/**
 * What a ship says it is doing (docs/design/png/ReportLine.png,
 * docs/design/monitoring): the state's icon and word in its tone, the task
 * per kind and the step, the note in the foreground, truncated. In a row, all
 * on one line with when it reported, short ("2 min"), or both times in the
 * title. On the ship page, the note on the first line, the task and the step
 * under it, then when the report last changed ("changed 4 min ago"), apart
 * from last seen. "No report yet" before the crew reports. Never colour
 * alone: the icon and the word say the state.
 */
export function ReportLine({
  report,
  now,
  variant,
  viewerFleetId,
  isTimeInTitle = false,
  testId,
}: {
  report: ListedShip['report'];
  now: Date;
  variant: 'row' | 'full';
  /** The viewer's fleet: a message task in it reads "a message"; undefined until the session is known. */
  viewerFleetId: FleetId | undefined;
  /** FleetTable: the times move to the title, as LastSeen carries recency there. */
  isTimeInTitle?: boolean;
  /** The test id of the line, by where it shows. */
  testId: string;
}) {
  if (report === null) {
    return (
      <span
        data-testid={testId}
        data-state="none"
        className={classNames('flex min-w-0 items-center gap-1.5 text-muted-foreground', variant === 'full' ? 'text-body' : 'text-meta')}
      >
        No report yet
      </span>
    );
  }
  return variant === 'full' ? (
    <FullReport report={report} now={now} viewerFleetId={viewerFleetId} testId={testId} />
  ) : (
    <RowReport report={report} now={now} viewerFleetId={viewerFleetId} isTimeInTitle={isTimeInTitle} testId={testId} />
  );
}

function StateWord({ state }: { state: ReportState }) {
  const Icon = ICONS[state];
  const tone = TONE_TEXT[REPORT_TONES[state]];
  return (
    <>
      <Icon aria-hidden className={classNames('size-(--size-icon-sm) shrink-0', tone)} />
      <span className={classNames('shrink-0 font-medium', tone)}>{REPORT_STATE_WORDS[state]}</span>
    </>
  );
}

function RowReport({
  report,
  now,
  viewerFleetId,
  isTimeInTitle,
  testId,
}: {
  report: Report;
  now: Date;
  viewerFleetId: FleetId | undefined;
  isTimeInTitle: boolean;
  testId: string;
}) {
  const reportedAt = new Date(report.reportedAt);
  const title = isTimeInTitle
    ? `${reportText(report)} · ${reportChangedWhen(new Date(report.reportChangedAt), now)} · ${reportedWhen(reportedAt, now)}`
    : reportText(report);
  return (
    <span data-testid={testId} data-state={report.state} title={title} className="flex min-w-0 items-center gap-1.5 text-meta">
      <StateWord state={report.state} />
      {report.task === null ? null : <TaskLabel task={report.task} viewerFleetId={viewerFleetId} testId={`${testId}-task`} />}
      {report.step === null ? null : <StepText text={reportStepText(report.step, 'row')} testId={`${testId}-step`} />}
      {report.note === null ? null : <span className="min-w-0 truncate text-foreground">{report.note}</span>}
      {isTimeInTitle ? null : (
        <time dateTime={report.reportedAt} title={fullDateTime(reportedAt)} className="shrink-0 text-muted-foreground tabular-nums">
          {reportAge(reportedAt, now)}
        </time>
      )}
    </span>
  );
}

function FullReport({ report, now, viewerFleetId, testId }: { report: Report; now: Date; viewerFleetId: FleetId | undefined; testId: string }) {
  const changedAt = new Date(report.reportChangedAt);
  return (
    <span data-testid={testId} data-state={report.state} title={reportText(report)} className="flex min-w-0 flex-col gap-0.5 text-body">
      <span className="flex min-w-0 items-center gap-1.5">
        <StateWord state={report.state} />
        {report.note === null ? null : <span className="min-w-0 truncate text-foreground">{report.note}</span>}
      </span>
      {report.task === null && report.step === null ? null : (
        <span className="flex min-w-0 items-center gap-2">
          {report.task === null ? null : <TaskLabel task={report.task} viewerFleetId={viewerFleetId} testId={`${testId}-task`} />}
          {report.step === null ? null : <StepText text={reportStepText(report.step, 'full')} testId={`${testId}-step`} />}
        </span>
      )}
      <time
        dateTime={report.reportChangedAt}
        title={`${fullDateTime(changedAt)} · ${reportedWhen(new Date(report.reportedAt), now)}`}
        data-testid={`${testId}-changed`}
        className="text-meta text-muted-foreground tabular-nums"
      >
        {reportChangedWhen(changedAt, now)}
      </time>
    </span>
  );
}

/** The task per kind: a link in a new tab where it has one, muted text otherwise; its title holds the whole URL or the ids. */
function TaskLabel({ task, viewerFleetId, testId }: { task: ReportTask; viewerFleetId: FleetId | undefined; testId: string }) {
  const { icon, label, title, href } = reportTaskLabel(task, viewerFleetId);
  const Icon = TASK_ICONS[icon];
  const content = (
    <>
      <Icon aria-hidden className="size-(--size-icon-sm) shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );
  // The label keeps its width up to a cap, so the note truncates first, as a long URL does past the cap.
  const frame = 'inline-flex min-w-0 max-w-48 shrink-0 items-center gap-1 font-mono text-meta';
  return href === null ? (
    <span data-testid={testId} title={title} className={classNames(frame, 'text-muted-foreground')}>
      {content}
    </span>
  ) : (
    <a
      data-testid={testId}
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      className={classNames(frame, 'text-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring')}
    >
      {content}
    </a>
  );
}

function StepText({ text, testId }: { text: string; testId: string }) {
  return (
    <span data-testid={testId} className="shrink-0 whitespace-nowrap text-meta text-muted-foreground tabular-nums">
      {text}
    </span>
  );
}
