import { beforeEach, describe, expect, it } from 'vitest';

import { identityUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import type { Guide } from './guide.js';

// The installation sets the console's guide (decision 0024): the one it sets
// replaces the one before; none clears it.

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;

function aGuide(overrides: Partial<Guide> = {}): Guide {
  return {
    audience: 'viewers',
    steps: [
      { path: '/', anchor: 'fleet-table', title: 'Your fleet', text: 'Every ship, its type and who crews it.' },
      { path: '/squadrons', title: 'The squadron', text: 'A team of ships formed from a blueprint.' },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  core = createInMemoryCore('2026-10-05T09:00:00.000Z');
  useCases = identityUseCases(core);
});

describe('setting the guide', () => {
  it('reads none before the installation sets one', async () => {
    await expect(useCases.getGuide()).resolves.toBeNull();
  });

  it('replaces the guide set before', async () => {
    await useCases.setGuide({ guide: aGuide({ audience: 'operators' }) });

    await useCases.setGuide({ guide: aGuide() });

    await expect(useCases.getGuide()).resolves.toEqual(aGuide());
  });

  it('to none clears it', async () => {
    await useCases.setGuide({ guide: aGuide() });

    await useCases.setGuide({ guide: null });

    await expect(useCases.getGuide()).resolves.toBeNull();
  });

  it('writes no event: the guide belongs to the installation, not to a fleet', async () => {
    await useCases.setGuide({ guide: aGuide() });

    expect(core.state.events).toEqual([]);
  });
});
