import type { ActivityKind, ListedActivity } from '@aeolus-fleet/common';
import { isActivityUnknown } from '@aeolus-fleet/common/rules';

import { relativeTime } from './relative-time';
import { reportAge } from './report';

/** An activity kind as a row words it, short: "tool 2 min". */
const ROW_WORDS: Record<ActivityKind, string> = { text: 'text', tool: 'tool', result: 'result', error: 'error' };

/** An activity kind as the ship page words it: "Tool call 2 min ago". */
const LINE_WORDS: Record<ActivityKind, string> = { text: 'Text', tool: 'Tool call', result: 'Tool result', error: 'Error' };

/** What the console shows of a ship's activity, and whether it reads unknown (the trierarch is likely down, never stopped work). */
export interface ActivityText {
  isUnknown: boolean;
  text: string;
}

/** The activity for the overview's Seen cell (docs/design/monitoring, 4.8): "tool 2 min", or "unknown". */
export function activityRow(activity: ListedActivity, now: Date): ActivityText {
  return isUnknownAt(activity, now) ? { isUnknown: true, text: 'unknown' } : { isUnknown: false, text: `${ROW_WORDS[activity.kind]} ${reportAge(new Date(activity.at), now)}` };
}

/** The ship page's Activity line (docs/design/monitoring, 4.3): "Tool call 2 min ago", or "Activity unknown, trierarch last reported 25 min ago". */
export function activityLine(activity: ListedActivity, now: Date): ActivityText {
  return isUnknownAt(activity, now)
    ? { isUnknown: true, text: `Activity unknown, trierarch last reported ${ago(new Date(activity.reportedAt), now)}` }
    : { isUnknown: false, text: `${LINE_WORDS[activity.kind]} ${ago(new Date(activity.at), now)}` };
}

function isUnknownAt(activity: ListedActivity, now: Date): boolean {
  return isActivityUnknown({ reportedAt: new Date(activity.reportedAt), intervalSeconds: activity.intervalSeconds }, now);
}

function ago(at: Date, now: Date): string {
  const when = relativeTime(at, now);
  return when === 'Just now' ? 'just now' : when;
}
