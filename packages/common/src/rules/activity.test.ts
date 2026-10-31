import { describe, expect, it } from 'vitest';

import { isActivityUnknown } from './activity.js';

// Activity reads unknown past twice the report interval the trierarch states
// with each write (docs/design/monitoring, 4.3, N4): a trierarch that is
// down reads as unknown, never as stopped work.

describe('activity unknown', () => {
  const written = { reportedAt: new Date('2026-10-31T09:00:00.000Z'), intervalSeconds: 60 };

  it('is known up to twice the interval the trierarch stated', () => {
    expect(isActivityUnknown(written, new Date('2026-10-31T09:02:00.000Z'))).toBe(false);
  });

  it('is unknown once the write is older than twice the interval', () => {
    expect(isActivityUnknown(written, new Date('2026-10-31T09:02:00.001Z'))).toBe(true);
  });
});
