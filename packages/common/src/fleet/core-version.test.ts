import { describe, expect, it } from 'vitest';

import { coreVersionRefusal, type VersionFetch } from './core-version.js';

const FLEET_URL = 'https://fleet.example';

/** A core that answers `/api/version` with this body, recording each URL asked. */
function aCore(body: unknown, status = 200): VersionFetch & { asked: string[] } {
  const asked: string[] = [];
  const fetch = (url: string) => {
    asked.push(url);
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
  };
  return Object.assign(fetch, { asked });
}

function refusalWith(fetch: VersionFetch, minimum = '0.27.0') {
  return coreVersionRefusal({ packageName: 'squadrons', version: '0.27.4', minimum, fleetUrl: FLEET_URL, fetch });
}

describe('the minimum core version a package of another train needs (decision 0049)', () => {
  it('passes a core at the minimum', async () => {
    expect(await refusalWith(aCore({ server: '0.27.0', common: '0.27.0' }))).toBeUndefined();
  });

  it('passes a core newer than the minimum, compared by number and not as text', async () => {
    expect(await refusalWith(aCore({ server: '0.100.0', common: '0.100.0' }), '0.27.0')).toBeUndefined();
  });

  it('passes a core whose patch is newer', async () => {
    expect(await refusalWith(aCore({ server: '0.27.1', common: '0.27.1' }))).toBeUndefined();
  });

  it('passes core 0.0.0, a build from main', async () => {
    expect(await refusalWith(aCore({ server: '0.0.0', common: '0.0.0' }))).toBeUndefined();
  });

  it('refuses a core one patch older, naming the package, its version, the minimum and the core it found', async () => {
    expect(await refusalWith(aCore({ server: '0.26.9', common: '0.26.9' }), '0.27.0')).toBe(
      'squadrons 0.27.4 needs core 0.27.0 or later; the fleet at https://fleet.example runs core 0.26.9: upgrade core first',
    );
  });

  it('refuses a core of an older minor whose patch is higher', async () => {
    expect(await refusalWith(aCore({ server: '0.26.12', common: '0.26.12' }), '0.27.1')).toBe(
      'squadrons 0.27.4 needs core 0.27.1 or later; the fleet at https://fleet.example runs core 0.26.12: upgrade core first',
    );
  });

  it('asks the fleet at /api/version, keeping its path, whether or not it ends in a slash', async () => {
    const core = aCore({ server: '0.27.0', common: '0.27.0' });
    await coreVersionRefusal({ packageName: 'squadrons', version: '0.27.4', minimum: '0.27.0', fleetUrl: 'https://example.com/fleet/', fetch: core });
    expect(core.asked).toEqual(['https://example.com/fleet/api/version']);
  });

  it('refuses when the fleet does not answer, saying why', async () => {
    const down: VersionFetch = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:4000'));
    expect(await refusalWith(down)).toBe(
      'squadrons 0.27.4 needs core 0.27.0 or later, and could not read the version of the fleet at https://fleet.example: connect ECONNREFUSED 127.0.0.1:4000',
    );
  });

  it('refuses when the fleet answers an HTTP error', async () => {
    expect(await refusalWith(aCore({}, 503))).toBe('squadrons 0.27.4 needs core 0.27.0 or later, and could not read the version of the fleet at https://fleet.example: HTTP 503');
  });

  it('refuses when the answer holds no version', async () => {
    expect(await refusalWith(aCore({ squadrons: '0.27.0' }))).toBe(
      'squadrons 0.27.4 needs core 0.27.0 or later, and could not read the version of the fleet at https://fleet.example: its /api/version answered no core version',
    );
  });

  it('refuses when the version is not MAJOR.MINOR.PATCH', async () => {
    expect(await refusalWith(aCore({ server: '0.27', common: '0.27' }))).toBe(
      'squadrons 0.27.4 needs core 0.27.0 or later, and could not read the version of the fleet at https://fleet.example: its /api/version answered no core version',
    );
  });
});
