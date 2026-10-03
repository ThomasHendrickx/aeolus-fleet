import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { fakeCatalogueSource, memoryCatalogueHolder, memoryRepositoryStore } from '../../../test/support/memory-catalogue.js';
import type { SourceFile } from './ports.js';
import { createRefreshCatalogue } from './refresh-catalogue.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const ADDED = new Date('2026-10-03T09:00:00.000Z');
const NOW = new Date('2026-10-03T10:00:00.000Z');

function tester(repository: string): SourceFile {
  return {
    repository,
    kind: 'template',
    name: 'tester',
    version: 1,
    file: '.aeolus/squadrons/templates/tester.yaml',
    commit: 'c1',
    committedAt: ADDED,
    content: { description: 'Tests.', checkIn: '30m', charter: 'You test.' },
  };
}

let store: ReturnType<typeof memoryRepositoryStore>;
let source: ReturnType<typeof fakeCatalogueSource>;
let holder: ReturnType<typeof memoryCatalogueHolder>;
let refresh: ReturnType<typeof createRefreshCatalogue>;

beforeEach(async () => {
  store = memoryRepositoryStore();
  source = fakeCatalogueSource();
  holder = memoryCatalogueHolder();
  refresh = createRefreshCatalogue({ store, source, holder, clock: { now: () => NOW } });
  for (const name of ['github.com/acme/one', 'github.com/acme/two']) {
    await store.add({ fleetId: FLEET, name, url: `https://${name}`, path: '.aeolus/squadrons', token: name.endsWith('two') ? 'ghp_two' : null, addedAt: ADDED, lastFetch: null });
    source.files.set(name, [tester(name)]);
  }
  await store.add({ fleetId: OTHER_FLEET, name: 'github.com/other/fleet', url: 'https://github.com/other/fleet', path: '.aeolus/squadrons', token: null, addedAt: ADDED, lastFetch: null });
});

describe('refreshing the catalogue', () => {
  it("fetches every repository of the fleet, with its token, and serves their versions", async () => {
    await refresh(FLEET, 'all');

    expect(source.fetches).toEqual(['github.com/acme/one', 'github.com/acme/two']);
    expect(source.tokens.get('github.com/acme/two')).toBe('ghp_two');
    expect(holder.catalogue.templates.map((template) => template.repository)).toEqual(['github.com/acme/one', 'github.com/acme/two']);
  });

  it('records when each repository was fetched, and why one could not be', async () => {
    source.failing.set('github.com/acme/two', 'Authentication failed');

    await refresh(FLEET, 'all');

    expect((await store.list(FLEET)).map(({ name, lastFetch }) => ({ name, lastFetch }))).toEqual([
      { name: 'github.com/acme/one', lastFetch: { at: NOW, error: null } },
      { name: 'github.com/acme/two', lastFetch: { at: NOW, error: 'Authentication failed' } },
    ]);
    expect(holder.catalogue.templates.map((template) => template.repository)).toEqual(['github.com/acme/one']);
  });

  it('fetches only the named repository, and serves the others from what they last fetched', async () => {
    await refresh(FLEET, 'all');
    source.fetches.length = 0;

    await refresh(FLEET, { name: 'github.com/acme/two' });

    expect(source.fetches).toEqual(['github.com/acme/two']);
    expect(holder.catalogue.templates).toHaveLength(2);
  });

  it('runs one refresh at a time, so a refresh started later is never overwritten by one that read the repositories before it', async () => {
    const release = source.holdNextRead();
    const earlier = refresh(FLEET, 'all');
    await store.remove(FLEET, 'github.com/acme/two');
    const later = refresh(FLEET, 'none');
    release();

    await Promise.all([earlier, later]);

    expect(holder.catalogue.templates.map((template) => template.repository)).toEqual(['github.com/acme/one']);
  });

  it('runs the next refresh after one that failed', async () => {
    let isDown = true;
    const flaky = { ...store, list: (fleetId: FleetId) => (isDown ? Promise.reject(new Error('database down')) : store.list(fleetId)) };
    const refreshing = createRefreshCatalogue({ store: flaky, source, holder, clock: { now: () => NOW } });
    await expect(refreshing(FLEET, 'all')).rejects.toThrow('database down');
    isDown = false;

    await refreshing(FLEET, 'all');

    expect(holder.catalogue.templates).toHaveLength(2);
  });

  it('fetches nothing when asked for none: the catalogue is built from what each repository last fetched', async () => {
    await refresh(FLEET, 'none');

    expect(source.fetches).toEqual([]);
    expect(holder.catalogue.templates).toEqual([]);
    expect((await store.list(FLEET)).every((repository) => repository.lastFetch === null)).toBe(true);
  });
});
