import { describe, expect, it } from 'vitest';
import type { ReportTask } from '@aeolus-fleet/common';
import { messageTaskViews } from './message-task-views';

const FLEET = 'flt_01m5aa4k2v9qz8f7x3n5c19q2d';
const MESSAGE = 'msg_01m66p4k2v9qz8f7x3n5c1k2q9';
const TASK: ReportTask = { kind: 'message', fleetId: FLEET, messageId: MESSAGE, canOpen: false, fleetName: null };
const ENVIRONMENT = { AEOLUS_PAGASAE_URL: 'https://accounts.example', AEOLUS_PAGASAE_CLIENT_ID: 'console', AEOLUS_PAGASAE_CLIENT_SECRET: 'test-secret', AEOLUS_SERVER_URL: 'https://fleet.example' };

function viewer({ isMember = true, canOpen = true, isDown = false } = {}) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (isDown) {
      return Promise.resolve(new Response('', { status: 503 }));
    }
    if (url.pathname === '/api/apps') {
      return Promise.resolve(Response.json({ fleets: isMember ? [{ id: FLEET, name: 'Other fleet', argo: false, apps: [{ app: 'console' }] }] : [] }));
    }
    if (url.pathname === '/oauth/token') {
      expect(new URLSearchParams(typeof init?.body === 'string' ? init.body : '').get('resource')).toBe(FLEET);
      return Promise.resolve(Response.json({ access_token: 'viewer-token', expires_in: 600 }));
    }
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer viewer-token');
    expect(url.pathname).toBe('/trpc/fleet.messageTaskAccess');
    return Promise.resolve(Response.json({ result: { data: { items: [{ messageId: MESSAGE, canOpen }] } } }));
  };
}

describe('a message task in another fleet, for this viewer', () => {
  it('shows the fleet name and opens only with the viewer token and read reach there', async () => {
    // Given a shared sign-in belonging to the referenced fleet.
    const input = { environment: ENVIRONMENT, cookieHeader: 'aeolus_account_session=shared', viewerFleetId: 'flt_current' };
    // When the console reads the reference for viewers with different reach.
    const allowed = await messageTaskViews([TASK], { ...input, fetchImplementation: viewer() });
    const outside = await messageTaskViews([TASK], { ...input, fetchImplementation: viewer({ canOpen: false }) });
    // Then both know their fleet's name, but only one may open the message.
    expect(allowed[0]).toMatchObject({ fleetName: 'Other fleet', canOpen: true });
    expect(outside[0]).toMatchObject({ fleetName: 'Other fleet', canOpen: false });
  });

  it('keeps a fleet outside membership, pagasae down and self-hosted as plain text', async () => {
    // Given references to a fleet the viewer cannot establish membership in.
    const input = { environment: ENVIRONMENT, cookieHeader: 'aeolus_account_session=shared', viewerFleetId: 'flt_current' };
    // When membership is absent, unavailable, or no pagasae is configured.
    const results = await Promise.all([
      messageTaskViews([TASK], { ...input, fetchImplementation: viewer({ isMember: false }) }),
      messageTaskViews([TASK], { ...input, fetchImplementation: viewer({ isDown: true }) }),
      messageTaskViews([TASK], { ...input, environment: {} }),
    ]);
    // Then no link or fleet name is invented.
    expect(results).toEqual([[TASK], [TASK], [TASK]]);
  });
});
