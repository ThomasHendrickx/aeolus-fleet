import { beforeEach, describe, expect, it } from 'vitest';

import { identityUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import type { Guide } from './guide.js';

// The installation reads back the guide it set (decision 0024).

let useCases: ReturnType<typeof identityUseCases>;

const guide: Guide = { audience: 'everyone', steps: [{ path: '/', title: 'Welcome', text: 'A short tour of the console.' }] };

beforeEach(() => {
  useCases = identityUseCases(createInMemoryCore('2026-10-05T09:00:00.000Z'));
});

describe('getting the guide', () => {
  it('is none before the installation sets one', async () => {
    await expect(useCases.getGuide()).resolves.toBeNull();
  });

  it('is the guide as the installation set it', async () => {
    await useCases.setGuide({ guide });

    await expect(useCases.getGuide()).resolves.toEqual(guide);
  });
});
