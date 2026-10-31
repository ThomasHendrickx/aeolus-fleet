import { describe, expect, it } from 'vitest';

import { featureFlagsOfSession } from './feature-flags-of-session';

const SESSION = { fleetId: 'flt_01jb8xk4tqzr3a9w6m2v5nyb4c', fleetName: 'acme-ops', expiresAt: '2026-11-29T12:00:00.000Z', kind: 'operator', scopes: ['fleet:read'] };

/** The fleet server answering console.session with this session, as tRPC wraps it. */
function answering(session: object): typeof fetch {
  return () => Promise.resolve(Response.json({ result: { data: session } }));
}

describe('the feature flags of the console session, read on the web app server (decision 0069)', () => {
  it('are the flags console.session answers on', async () => {
    await expect(featureFlagsOfSession({ serverUrl: 'http://fleet', cookie: 'aeolus_session=x', fetchImplementation: answering({ ...SESSION, featureFlags: ['sealing'] }) })).resolves.toEqual(['sealing']);
    await expect(featureFlagsOfSession({ serverUrl: 'http://fleet', cookie: 'aeolus_session=x', fetchImplementation: answering({ ...SESSION, featureFlags: [] }) })).resolves.toEqual([]);
  });

  it('are unknown when signed out, without asking the server', async () => {
    await expect(featureFlagsOfSession({ serverUrl: 'http://127.0.0.1:1', cookie: '' })).resolves.toBeUndefined();
  });

  it('are unknown when the server does not answer, so the page shows its own error', async () => {
    await expect(featureFlagsOfSession({ serverUrl: 'http://127.0.0.1:1', cookie: 'aeolus_session=x' })).resolves.toBeUndefined();
  });
});
