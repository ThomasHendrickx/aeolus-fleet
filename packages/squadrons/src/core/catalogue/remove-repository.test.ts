import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { fakeCatalogueSource, memoryCatalogueHolder, memoryRepositoryStore } from '../../../test/support/memory-catalogue.js';
import { createRefreshCatalogue } from './refresh-catalogue.js';
import { createRemoveRepository } from './remove-repository.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const NOW = new Date('2026-10-03T10:00:00.000Z');

let store: ReturnType<typeof memoryRepositoryStore>;
let source: ReturnType<typeof fakeCatalogueSource>;
let holder: ReturnType<typeof memoryCatalogueHolder>;
let refresh: ReturnType<typeof createRefreshCatalogue>;
let removeRepository: ReturnType<typeof createRemoveRepository>;

beforeEach(async () => {
  store = memoryRepositoryStore();
  source = fakeCatalogueSource();
  holder = memoryCatalogueHolder();
  refresh = createRefreshCatalogue({ store, source, holder, clock: { now: () => NOW } });
  removeRepository = createRemoveRepository({ store, source, refresh });
  await store.add({ fleetId: FLEET, name: 'github.com/acme/templates', url: 'https://github.com/acme/templates', path: '.aeolus/squadrons', token: null, addedAt: NOW, lastFetch: null });
  source.files.set('github.com/acme/templates', [
    { repository: 'github.com/acme/templates', kind: 'template', name: 'tester', version: 1, file: '.aeolus/squadrons/templates/tester.yaml', commit: 'c1', committedAt: NOW, content: { description: 'Tests.', checkIn: '30m', charter: 'You test.' } },
  ]);
  await refresh(FLEET, 'all');
  source.fetches.length = 0;
});

describe('removing a template repository', () => {
  it('forgets it, and its versions leave the catalogue at once, fetching nothing', async () => {
    expect(holder.catalogue.templates).toHaveLength(1);

    await expect(removeRepository({ fleetId: FLEET, name: 'github.com/acme/templates' })).resolves.toEqual({ isOk: true, value: undefined });

    expect(store.held).toEqual([]);
    expect(holder.catalogue.templates).toEqual([]);
    expect(source.fetches).toEqual([]);
  });

  it("deletes what it fetched, so the repository added again serves nothing it cannot fetch itself", async () => {
    await removeRepository({ fleetId: FLEET, name: 'github.com/acme/templates' });
    await store.add({ fleetId: FLEET, name: 'github.com/acme/templates', url: 'https://github.com/acme/templates', path: '.aeolus/squadrons', token: null, addedAt: NOW, lastFetch: null });
    source.failing.set('github.com/acme/templates', 'Authentication failed');

    await refresh(FLEET, { name: 'github.com/acme/templates' });

    expect(source.forgotten).toEqual([{ fleetId: FLEET, url: 'https://github.com/acme/templates' }]);
    expect(holder.catalogue.templates).toEqual([]);
  });

  it('refuses a repository that is not there', async () => {
    await expect(removeRepository({ fleetId: FLEET, name: 'github.com/acme/other' })).resolves.toMatchObject({ isOk: false, error: { kind: 'REPOSITORY_NOT_FOUND' } });
  });
});
