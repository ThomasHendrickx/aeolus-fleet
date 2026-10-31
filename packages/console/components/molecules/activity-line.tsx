import type { ListedActivity } from '@aeolus-fleet/common';
import { classNames } from '@aeolus-fleet/common/header';
import { Terminal } from 'lucide-react';

import { activityLine, activityRow } from '../../lib/activity';
import { fullDateTime } from '../../lib/relative-time';

/**
 * What a ship's trierarch last observed of its session, beside last seen
 * (docs/design/monitoring, 4.3 and 4.8): on a row the kind and its age
 * ("tool 2 min"), on the ship page a line ("Tool call 2 min ago"). Past twice
 * the interval the trierarch stated it reads unknown, in the waiting tone and
 * in words, never as stopped work. The title holds the time, the tool of a
 * tool call and when the trierarch wrote it. Nothing for a ship without
 * activity, such as one crewed by hand.
 */
export function ActivityLine({ activity, now, variant, testId }: { activity: ListedActivity | null; now: Date; variant: 'row' | 'full'; testId?: string }) {
  if (activity === null) {
    return null;
  }
  const { isUnknown, text } = variant === 'row' ? activityRow(activity, now) : activityLine(activity, now);
  const tool = activity.tool === null ? '' : ` · ${activity.tool}`;
  return (
    <span
      data-testid={testId}
      data-unknown={isUnknown ? '' : undefined}
      title={`${fullDateTime(new Date(activity.at))}${tool} · trierarch reported ${fullDateTime(new Date(activity.reportedAt))}`}
      className={classNames('inline-flex min-w-0 items-center gap-1 text-meta tabular-nums', isUnknown ? 'text-tone-waiting-fg' : 'text-muted-foreground')}
    >
      <Terminal aria-hidden className="size-(--size-icon-sm) shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  );
}
