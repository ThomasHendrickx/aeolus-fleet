import { beforeEach, describe, expect, it } from 'vitest';

import { identityUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import type { Notice } from './notice.js';

// The installation sets the console's notices (decision 0023): the list it
// sets replaces the one before, in its order.

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;

function aNotice(overrides: Partial<Notice> = {}): Notice {
  return { id: 'upgrade', audience: 'everyone', text: 'Interruptions expected between 00:00 and 01:00.', links: [], isDismissible: false, ...overrides };
}

beforeEach(() => {
  core = createInMemoryCore('2026-10-05T09:00:00.000Z');
  useCases = identityUseCases(core);
});

describe('setting the notices', () => {
  it('replaces the notices set before, in the order given', async () => {
    await useCases.setNotices({ notices: [aNotice({ id: 'limits', audience: 'operators' })] });

    const set = [aNotice({ id: 'welcome', audience: 'viewers', isDismissible: true }), aNotice()];
    await useCases.setNotices({ notices: set });

    await expect(useCases.getNotices()).resolves.toEqual(set);
  });

  it('to none clears them', async () => {
    await useCases.setNotices({ notices: [aNotice()] });

    await useCases.setNotices({ notices: [] });

    await expect(useCases.getNotices()).resolves.toEqual([]);
  });

  it('writes no event: notices belong to the installation, not to a fleet', async () => {
    await useCases.setNotices({ notices: [aNotice()] });

    expect(core.state.events).toEqual([]);
  });
});
