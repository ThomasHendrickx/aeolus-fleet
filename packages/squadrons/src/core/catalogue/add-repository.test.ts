import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { fakeCatalogueSource, memoryCatalogueHolder, memoryRepositoryStore } from '../../../test/support/memory-catalogue.js';
import { createAddRepository } from './add-repository.js';
import { createRefreshCatalogue } from './refresh-catalogue.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const NOW = new Date('2026-10-03T10:00:00.000Z');

let store: ReturnType<typeof memoryRepositoryStore>;
let source: ReturnType<typeof fakeCatalogueSource>;
let addRepository: ReturnType<typeof createAddRepository>;

beforeEach(() => {
  store = memoryRepositoryStore();
  source = fakeCatalogueSource();
  const clock = { now: () => NOW };
  addRepository = createAddRepository({ store, refresh: createRefreshCatalogue({ store, source, holder: memoryCatalogueHolder(), clock }), clock });
});

describe('adding a template repository', () => {
  it('stores it and fetches it at once, answering it as the list shows it: never its token', async () => {
    const added = await addRepository({ fleetId: FLEET, url: 'https://github.com/acme/templates.git', token: 'ghp_secret' });

    expect(added).toEqual({
      isOk: true,
      value: { name: 'github.com/acme/templates', url: 'https://github.com/acme/templates.git', path: '.aeolus/squadrons', hasToken: true, addedAt: NOW, lastFetch: { at: NOW, error: null } },
    });
    expect(source.fetches).toEqual(['github.com/acme/templates']);
    expect(store.held[0]?.token).toBe('ghp_secret');
  });

  it('keeps a repository whose first fetch fails, with why, so the operator sees it', async () => {
    source.failing.set('github.com/acme/private', 'Authentication failed');

    const added = await addRepository({ fleetId: FLEET, url: 'https://github.com/acme/private' });

    expect(added).toMatchObject({ isOk: true, value: { lastFetch: { at: NOW, error: 'Authentication failed' } } });
    expect(store.held).toHaveLength(1);
  });

  it('refuses a repository of that name added already', async () => {
    await addRepository({ fleetId: FLEET, url: 'https://github.com/acme/templates' });

    await expect(addRepository({ fleetId: FLEET, url: 'https://github.com/acme/templates.git' })).resolves.toMatchObject({ isOk: false, error: { kind: 'REPOSITORY_TAKEN' } });
    expect(source.fetches).toHaveLength(1);
  });

  it('refuses what is no https URL of a repository, storing and fetching nothing', async () => {
    await expect(addRepository({ fleetId: FLEET, url: 'file:///srv/templates' })).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_REPOSITORY' } });
    expect(store.held).toEqual([]);
    expect(source.fetches).toEqual([]);
  });
});
