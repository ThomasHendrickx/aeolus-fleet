import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { isClearing } from './clear-requests';

const newId = createIdGenerator();

describe('isClearing', () => {
  const worktree = { trierarchShipId: newId('ship'), shipId: newId('ship'), repository: 'aeolus-fleet' };

  it('is true while a clear request for the kept worktree waits for its trierarch', () => {
    expect(isClearing([{ ...worktree }], worktree)).toBe(true);
  });

  it('is false for a request of another trierarch, ship or repository', () => {
    expect(isClearing([{ ...worktree, trierarchShipId: newId('ship') }, { ...worktree, shipId: newId('ship') }, { ...worktree, repository: 'hemma' }], worktree)).toBe(false);
  });
});
