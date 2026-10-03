import type { FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaRepositoryStore } from '../src/adapters/prisma/repository-store.js';
import type { TemplateRepository } from '../src/core/catalogue/template-repository.js';
import { createSquadronsDatabase } from './support/database.js';

// The template repositories the operator set, in Postgres: one per fleet and
// name, oldest first, each with its last fetch.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const AT = new Date('2026-10-03T09:00:00.000Z');
const LATER = new Date('2026-10-03T09:10:00.000Z');

let prisma: PrismaClient;

function aRepository(name: string, fleetId: FleetId = FLEET): TemplateRepository {
  return { fleetId, name, url: `https://${name}`, path: '.aeolus/squadrons', token: name.endsWith('private') ? 'ghp_secret' : null, addedAt: AT, lastFetch: null };
}

beforeEach(async () => {
  prisma = createPrismaClient(await createSquadronsDatabase());
});

afterEach(async () => {
  await prisma.$disconnect();
});

describe('the repository store', () => {
  it("adds a fleet's repositories and lists them oldest first, with their tokens, never another fleet's", async () => {
    const store = createPrismaRepositoryStore(prisma);
    await store.add(aRepository('github.com/acme/private'));
    await store.add({ ...aRepository('github.com/acme/public'), addedAt: LATER });
    await store.add(aRepository('github.com/other/fleet', OTHER_FLEET));

    await expect(store.list(FLEET)).resolves.toEqual([aRepository('github.com/acme/private'), { ...aRepository('github.com/acme/public'), addedAt: LATER }]);
  });

  it('answers taken for a name the fleet has already, and keeps the first', async () => {
    const store = createPrismaRepositoryStore(prisma);
    await store.add(aRepository('github.com/acme/private'));

    await expect(store.add({ ...aRepository('github.com/acme/private'), url: 'https://github.com/acme/private.git' })).resolves.toBe('taken');
    await expect(store.list(FLEET).then((held) => held.map((each) => each.url))).resolves.toEqual(['https://github.com/acme/private']);
  });

  it('records the last fetch of a repository', async () => {
    const store = createPrismaRepositoryStore(prisma);
    await store.add(aRepository('github.com/acme/public'));

    await store.recordFetch(FLEET, { name: 'github.com/acme/public', at: LATER, error: 'Repository not found' });

    await expect(store.list(FLEET).then((held) => held[0]?.lastFetch)).resolves.toEqual({ at: LATER, error: 'Repository not found' });
  });

  it('removes a repository, and says whether there was one', async () => {
    const store = createPrismaRepositoryStore(prisma);
    await store.add(aRepository('github.com/acme/public'));

    await expect(store.remove(FLEET, 'github.com/acme/public')).resolves.toBe(true);
    await expect(store.remove(FLEET, 'github.com/acme/public')).resolves.toBe(false);
    await expect(store.list(FLEET)).resolves.toEqual([]);
  });
});
