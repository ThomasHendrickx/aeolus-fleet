import type { FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { memoryRepositoryStore } from '../../../test/support/memory-catalogue.js';
import { createListRepositories } from './list-repositories.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const AT = new Date('2026-10-03T10:00:00.000Z');

describe('listing the template repositories', () => {
  it("answers the fleet's repositories with whether each has a token, never the token", async () => {
    const store = memoryRepositoryStore();
    await store.add({ fleetId: FLEET, name: 'github.com/acme/private', url: 'https://github.com/acme/private', path: 'ops', token: 'ghp_secret', addedAt: AT, lastFetch: { at: AT, error: null } });
    await store.add({ fleetId: OTHER_FLEET, name: 'github.com/other/fleet', url: 'https://github.com/other/fleet', path: '.aeolus/squadrons', token: null, addedAt: AT, lastFetch: null });

    const listed = await createListRepositories({ store })(FLEET);

    expect(listed).toEqual([{ name: 'github.com/acme/private', url: 'https://github.com/acme/private', path: 'ops', hasToken: true, addedAt: AT, lastFetch: { at: AT, error: null } }]);
    expect(JSON.stringify(listed)).not.toContain('ghp_secret');
  });
});
