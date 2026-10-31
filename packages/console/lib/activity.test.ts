import type { ListedActivity } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { activityLine, activityRow } from './activity';

// Observed activity beside last seen (docs/design/monitoring, 4.3 and 4.8;
// mockups: the overview's Seen cell and the ship page's Activity line).

const NOW = new Date('2026-10-31T13:05:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function anActivity(change: Partial<ListedActivity> = {}): ListedActivity {
  return { at: ago(2 * 60_000), kind: 'tool', tool: 'Bash', reportedAt: ago(10_000), intervalSeconds: 30, ...change };
}

describe("the overview's Seen cell", () => {
  it('shows the kind and how long ago: tool 2 min', () => {
    expect(activityRow(anActivity(), NOW)).toEqual({ isUnknown: false, text: 'tool 2 min' });
  });

  it('shows unknown once the trierarch wrote longer ago than twice its interval', () => {
    expect(activityRow(anActivity({ reportedAt: ago(25 * 60_000) }), NOW)).toEqual({ isUnknown: true, text: 'unknown' });
  });
});

describe("the ship page's Activity line", () => {
  it.each([
    ['tool', 'Tool call 2 min ago'],
    ['text', 'Text 2 min ago'],
    ['result', 'Tool result 2 min ago'],
    ['error', 'Error 2 min ago'],
  ] as const)('words a %s as %s', (kind, line) => {
    expect(activityLine(anActivity({ kind }), NOW)).toEqual({ isUnknown: false, text: line });
  });

  it('says when the trierarch last reported once activity is unknown, never stopped work', () => {
    expect(activityLine(anActivity({ reportedAt: ago(25 * 60_000) }), NOW)).toEqual({ isUnknown: true, text: 'Activity unknown, trierarch last reported 25 min ago' });
  });
});
