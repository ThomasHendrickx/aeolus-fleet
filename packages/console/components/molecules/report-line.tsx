import type { FleetId, ListedShip, ReportTask } from '@aeolus-fleet/common';
import { CircleDot, CircleHelp, GitPullRequest, Link, Mail, type LucideIcon } from 'lucide-react';

import { classNames, ShipState } from '@aeolus-fleet/ui';
import { fullDateTime } from '../../lib/relative-time';
import { reportAge, reportChangedWhen, reportedWhen, reportText } from '../../lib/report';
import { reportStepText, reportTaskLabel, type ReportTaskLabel } from '../../lib/report-task';

const TASK_ICONS: Record<ReportTaskLabel['icon'], LucideIcon> = {
  pullRequest: GitPullRequest,
  issue: CircleDot,
  link: Link,
  message: Mail,
  unknown: CircleHelp,
};

type Report = NonNullable<ListedShip['report']>;

/**
 * What a ship says it is doing (docs/design/png/ReportLine.png,
 * docs/design/monitoring): the state as ShipState draws it (docs/design/state-colours), the task
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
      <ShipState state={report.state} className="shrink-0" />
      {report.task === null ? null : <TaskLabel task={{ ...report.task, canOpen: report.taskView?.canOpen === true, fleetName: report.taskView?.fleetName ?? null }} viewerFleetId={viewerFleetId} testId={`${testId}-task`} />}
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
        <ShipState state={report.state} className="shrink-0" />
        {report.note === null ? null : <span className="min-w-0 truncate text-foreground">{report.note}</span>}
      </span>
      {report.task === null && report.step === null ? null : (
        <span className="flex min-w-0 items-center gap-2">
          {report.task === null ? null : <TaskLabel task={{ ...report.task, canOpen: report.taskView?.canOpen === true, fleetName: report.taskView?.fleetName ?? null }} viewerFleetId={viewerFleetId} testId={`${testId}-task`} />}
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

/** The task per kind: a link where the server allows it, URL tasks in a new tab, muted text otherwise; its title holds the whole URL or the ids. */
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
      target={task.kind === 'url' ? '_blank' : undefined}
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
