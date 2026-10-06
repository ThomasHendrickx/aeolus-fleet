import { beforeEach, describe, expect, it } from 'vitest';

import { identityUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import type { Notice } from './notice.js';

// The notices the installation set (decision 0023), as it reads them back.

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;

const upgrade: Notice = { id: 'upgrade', audience: 'everyone', text: 'Interruptions expected between 00:00 and 01:00.', links: [], isDismissible: false };

beforeEach(() => {
  core = createInMemoryCore('2026-10-05T09:00:00.000Z');
  useCases = identityUseCases(core);
});

describe('the notices the installation reads back', () => {
  it('are none until it sets some', async () => {
    await expect(useCases.getNotices()).resolves.toEqual([]);
  });

  it('are those it set', async () => {
    await useCases.setNotices({ notices: [upgrade] });

    await expect(useCases.getNotices()).resolves.toEqual([upgrade]);
  });
});
