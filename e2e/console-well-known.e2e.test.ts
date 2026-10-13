import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// OAuth discovery at the console (#764): the fleet has no OAuth, so an MCP
// client that probes these paths first must hear 404, not a redirect to
// sign-in, and then connects without auth.

/** Nothing listens here: a request without a session cookie asks the server nothing. */
const NO_SERVER_URL = 'http://127.0.0.1:9';
const NOT_FOUND = 404;

let web: RunningWeb;

beforeAll(async () => {
  web = await startWeb({ url: await reserveWebUrl(), serverUrl: NO_SERVER_URL });
});

afterAll(async () => {
  await web.stop();
});

describe('OAuth discovery at the console', () => {
  it.each(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'])(
    'answers %s with 404 without a session, not a redirect to sign-in',
    async (path) => {
      const response = await fetch(`${web.url}${path}`, { redirect: 'manual' });

      expect(response.status).toBe(NOT_FOUND);
    },
  );
});
