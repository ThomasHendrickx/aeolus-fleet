import type { ListedShip } from '@aeolus-fleet/common';

import { relativeTime } from './relative-time';

const STATE_WORDS = { working: 'Working', blocked: 'Blocked', idle: 'Idle' } as const;

/**
 * A crew's last report in one line: "Blocked · waiting for review · 3 min
 * ago", the note left out when there is none. Said in words, never by colour
 * alone. Plain data: nothing acts on it.
 */
export function reportLine(report: NonNullable<ListedShip['report']>, now: Date): string {
  const when = relativeTime(new Date(report.reportedAt), now);
  return [STATE_WORDS[report.state], report.note, when === 'Just now' ? 'just now' : when]
    .filter((part) => part !== null)
    .join(' · ');
}
