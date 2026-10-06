import { describe, expect, it } from 'vitest';

import { isUnclaimedPromptOut } from './starting-prompt';

const issuedAt = '2026-09-29T12:00:00.000Z';

describe('isUnclaimedPromptOut', () => {
  it('is true for a prompt no session has claimed', () => {
    expect(isUnclaimedPromptOut({ startingPrompt: { issuedAt, isClaimed: false } })).toBe(true);
  });

  it('is false once a session claimed the ship with it', () => {
    expect(isUnclaimedPromptOut({ startingPrompt: { issuedAt, isClaimed: true } })).toBe(false);
  });

  it('is false when no prompt is out', () => {
    expect(isUnclaimedPromptOut({ startingPrompt: null })).toBe(false);
  });
});
