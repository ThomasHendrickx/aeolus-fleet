import type { ListedShip } from '@aeolus-fleet/common';

import { fullDateTime } from '../../lib/relative-time';
import { reportLine } from '../../lib/report';

/**
 * A crew's last report, under its Last seen: "Working · on PR 89 · 3 min
 * ago". Said in words, never by colour alone. Nothing before the crew reports.
 */
export function ReportStatus({
  report,
  now,
  testId,
}: {
  report: ListedShip['report'];
  now: Date;
  /** The test id of the line, by where it shows. */
  testId: string;
}) {
  if (report === null) {
    return null;
  }
  return (
    <span
      title={`Reported ${fullDateTime(new Date(report.reportedAt))}`}
      data-testid={testId}
      data-state={report.state}
      className="text-meta text-foreground [overflow-wrap:anywhere]"
    >
      {reportLine(report, now)}
    </span>
  );
}
