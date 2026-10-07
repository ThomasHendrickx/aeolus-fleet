import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  CLEAR_OUTCOMES,
  CLEAR_REQUESTS_PER_TRIERARCH_MAX,
  clearRequestsOutputSchema,
  clearWorktreeInputSchema,
  clearWorktreeOutputSchema,
  confirmWorktreeClearedInputSchema,
  confirmWorktreeClearedOutputSchema,
} from './clear-request.js';

const newId = createIdGenerator();

describe('CLEAR_REQUESTS_PER_TRIERARCH_MAX', () => {
  it('is 100 (decision 0032)', () => {
    expect(CLEAR_REQUESTS_PER_TRIERARCH_MAX).toBe(100);
  });
});

describe('clearWorktreeInputSchema', () => {
  it('names the trierarch and the kept worktree by its ship and repository', () => {
    const input = { trierarchShipId: newId('ship'), shipId: newId('ship'), repository: 'aeolus-fleet' };

    expect(clearWorktreeInputSchema.parse(input)).toEqual(input);
  });

  it('refuses a path where a repository name belongs: paths stay on the machine', () => {
    expect(clearWorktreeInputSchema.safeParse({ trierarchShipId: newId('ship'), shipId: newId('ship'), repository: '/Users/thomas/aeolus-fleet' }).success).toBe(false);
  });
});

describe('clearWorktreeOutputSchema', () => {
  it('is empty: the OK is the answer', () => {
    expect(clearWorktreeOutputSchema.parse({})).toEqual({});
  });
});

describe('CLEAR_OUTCOMES', () => {
  it('knows removed and not-kept, nothing else', () => {
    expect(CLEAR_OUTCOMES).toEqual(['removed', 'not-kept']);
  });
});

describe('confirmWorktreeClearedInputSchema', () => {
  it('names the worktree and how its clearing came out', () => {
    const input = { shipId: newId('ship'), repository: 'aeolus-fleet', outcome: 'not-kept' };

    expect(confirmWorktreeClearedInputSchema.parse(input)).toEqual(input);
    expect(confirmWorktreeClearedInputSchema.safeParse({ ...input, outcome: 'failed' }).success).toBe(false);
  });
});

describe('confirmWorktreeClearedOutputSchema', () => {
  it('is empty: the OK is the answer', () => {
    expect(confirmWorktreeClearedOutputSchema.parse({})).toEqual({});
  });
});

describe('clearRequestsOutputSchema', () => {
  it('lists each pending request: the trierarch, the worktree, who asked and when (ISO 8601 in UTC)', () => {
    const listed = [
      { trierarchShipId: newId('ship'), shipId: newId('ship'), repository: 'aeolus-fleet', requestedBy: newId('ship'), requestedAt: '2026-10-07T15:00:00.000Z' },
    ];

    expect(clearRequestsOutputSchema.parse(listed)).toEqual(listed);
  });
});
