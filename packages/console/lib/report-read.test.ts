import { describe, expect, it } from 'vitest';
import { CREWED_SHIP } from './fixtures/ship-page.fixtures';
import { answerReportRead } from './report-read';

const CURRENT = 'flt_01m66p4k2v9qz8f7x3n5c17acm';
const OTHER = 'flt_01m5aa4k2v9qz8f7x3n5c19q2d';
const MESSAGE = 'msg_01m66p4k2v9qz8f7x3n5c1k2q9';
const ENVIRONMENT = { AEOLUS_PAGASAE_URL: 'https://accounts.example', AEOLUS_PAGASAE_CLIENT_ID: 'console', AEOLUS_PAGASAE_CLIENT_SECRET: 'test-secret', AEOLUS_SERVER_URL: 'https://fleet.example' };
const REPORT = { state: 'working', note: 'Drafting the guide', task: { kind: 'message', fleetId: OTHER, messageId: MESSAGE }, taskView: { canOpen: false, fleetName: null }, step: null, reportChangedAt: '2026-10-01T09:00:00.000Z', reportedAt: '2026-10-01T09:00:00.000Z', detailsVersion: 0, details: null, detailsBytes: null };

describe('a report and its other-fleet message task in the same read', () => {
  it.each(['fleet.list', 'fleet.listedShip', 'fleet.ship'])('answers %s with the authorized task and all its ship facts', async (procedure) => {
    // Given the viewer's ship report references another fleet it belongs to.
    const ship = { ...CREWED_SHIP, report: REPORT };
    const data = procedure === 'fleet.list' ? { items: [ship], nextCursor: null } : ship;
    const fetchImplementation: typeof fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === `/trpc/${procedure}`) {
        expect(new Headers(init?.headers).get('cookie')).toBe('aeolus_session=viewer');
        return Promise.resolve(Response.json({ result: { data } }));
      }
      if (url.pathname === '/trpc/console.session') {
        return Promise.resolve(Response.json({ result: { data: { fleetId: CURRENT, fleetName: 'Home', kind: 'operator', scopes: ['fleet:read'], featureFlags: [], expiresAt: '2026-11-01T00:00:00.000Z' } } }));
      }
      if (url.pathname === '/api/apps') {
        return Promise.resolve(Response.json({ fleets: [{ id: OTHER, name: 'Other fleet', argo: false, apps: [{ app: 'console' }] }] }));
      }
      if (url.pathname === '/oauth/token') {
        return Promise.resolve(Response.json({ access_token: 'other-viewer-token', expires_in: 600 }));
      }
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer other-viewer-token');
      return Promise.resolve(Response.json({ result: { data: { items: [{ messageId: MESSAGE, canOpen: true }] } } }));
    };

    // When the console reads the report with its sign-in.
    const response = await answerReportRead(new Request(`https://console.example/api/reports/${procedure}`, { headers: { cookie: 'aeolus_session=viewer; aeolus_account_session=shared' } }), { procedure, environment: ENVIRONMENT, fetchImplementation });
    const body: unknown = await response.json();

    // Then the same answer carries the task name and permission; the ship's details remain present.
    const expected = { report: { task: REPORT.task, taskView: { fleetName: 'Other fleet', canOpen: true } } };
    expect(body).toMatchObject({ result: { data: procedure === 'fleet.list' ? { items: [expected] } : expected } });
    if (procedure === 'fleet.ship') {
      expect(body).toMatchObject({ result: { data: { commissionedAt: CREWED_SHIP.commissionedAt, openDeliveries: 2, owner: CREWED_SHIP.owner } } });
    }
  });
});
