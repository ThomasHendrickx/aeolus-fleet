import { describe, expect, it, vi } from 'vitest';

import type { AnalyticsEvent, SessionKind } from './analytics';
import type { AnalyticsAdapter } from './analytics-adapter';
import { createDailySalt, handleAnalytics } from './analytics-route';

const SERVER_URL = 'http://server:4000';
const COOKIE = 'aeolus_session=ses_secret_value; theme=dark';

interface Captured {
  event: AnalyticsEvent;
  distinctId: string;
  sessionKind: SessionKind;
}

function anAdapter(options: { isFailing?: boolean } = {}): AnalyticsAdapter & { captured: Captured[] } {
  const captured: Captured[] = [];
  return {
    captured,
    capture: (event, from) => {
      captured.push({ event, ...from });
      return options.isFailing === true ? Promise.reject(new Error('provider down')) : Promise.resolve();
    },
  };
}

/** The server's console.session: the kind for a live session, 401 otherwise. */
function aServer(kind: SessionKind | undefined) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(kind === undefined ? new Response('{}', { status: 401 }) : Response.json({ result: { data: { kind, scopes: [] } } })),
  );
}

function aRequest(body: unknown, cookie = COOKIE): Request {
  return new Request('http://console/api/analytics', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

const fixedSalt = () => Buffer.from('salt');

describe('/api/analytics', () => {
  it('answers 404 without an adapter: the console then sends nothing', async () => {
    const response = await handleAnalytics(aRequest({ name: 'tour_finished' }), { adapter: undefined, serverUrl: SERVER_URL, salt: fixedSalt, fetchImplementation: aServer('operator') });

    expect(response.status).toBe(404);
  });

  it('hands a known event to the adapter as an anonymous visitor, with the session kind', async () => {
    const adapter = anAdapter();
    const server = aServer('viewer');

    const response = await handleAnalytics(aRequest({ name: 'tour_step_reached', step: 2, total: 6 }), { adapter, serverUrl: SERVER_URL, salt: fixedSalt, fetchImplementation: server });

    expect(response.status).toBe(204);
    expect(adapter.captured.map(({ event, sessionKind }) => ({ event, sessionKind }))).toEqual([{ event: { name: 'tour_step_reached', step: 2, total: 6 }, sessionKind: 'viewer' }]);
    expect(adapter.captured[0]?.distinctId).toMatch(/^[0-9a-f]{64}$/);
    expect(adapter.captured[0]?.distinctId).not.toContain('ses_secret_value');
    expect(server).toHaveBeenCalledWith(`${SERVER_URL}/trpc/console.session`, expect.objectContaining({ headers: { cookie: COOKIE } }));
  });

  it('drops an event outside the list, or with a property it may not carry', async () => {
    const adapter = anAdapter();

    const response = await handleAnalytics(aRequest({ name: 'ship_commissioned', shipName: 'scout' }), { adapter, serverUrl: SERVER_URL, salt: fixedSalt, fetchImplementation: aServer('operator') });

    expect(response.status).toBe(400);
    expect(adapter.captured).toEqual([]);
  });

  it('drops an event from no live console session', async () => {
    const adapter = anAdapter();

    const withoutCookie = await handleAnalytics(aRequest({ name: 'tour_finished' }, 'theme=dark'), { adapter, serverUrl: SERVER_URL, salt: fixedSalt, fetchImplementation: aServer('operator') });
    const ended = await handleAnalytics(aRequest({ name: 'tour_finished' }), { adapter, serverUrl: SERVER_URL, salt: fixedSalt, fetchImplementation: aServer(undefined) });

    expect([withoutCookie.status, ended.status]).toEqual([401, 401]);
    expect(adapter.captured).toEqual([]);
  });

  it('answers 204 even when the provider fails: the console never waits on analytics', async () => {
    const response = await handleAnalytics(aRequest({ name: 'tour_finished' }), { adapter: anAdapter({ isFailing: true }), serverUrl: SERVER_URL, salt: fixedSalt, fetchImplementation: aServer('operator') });

    expect(response.status).toBe(204);
  });

  it('keeps a session one visitor within a day, and another the next day', async () => {
    let today = new Date('2026-10-05T10:00:00.000Z');
    const salt = createDailySalt(() => today);
    const adapter = anAdapter();
    const send = () => handleAnalytics(aRequest({ name: 'tour_finished' }), { adapter, serverUrl: SERVER_URL, salt, fetchImplementation: aServer('operator') });

    await send();
    today = new Date('2026-10-05T23:59:00.000Z');
    await send();
    today = new Date('2026-10-06T00:01:00.000Z');
    await send();

    const [first, later, nextDay] = adapter.captured.map((captured) => captured.distinctId);
    expect(later).toBe(first);
    expect(nextDay).not.toBe(first);
  });
});
