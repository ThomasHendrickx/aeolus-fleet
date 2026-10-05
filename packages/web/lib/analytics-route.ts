import { createHmac, randomBytes } from 'node:crypto';

import { z } from 'zod';

import { analyticsEventSchema, type SessionKind } from './analytics';
import type { AnalyticsAdapter } from './analytics-adapter';
import { SESSION_COOKIE } from './console-gate';

/**
 * The web app's /api/analytics (decision 0025): the console's browser posts
 * one event; the web app's server checks it against the closed list, asks the
 * server which kind of session sent it, and hands it to the configured
 * adapter as an anonymous visitor. Without an adapter it answers 404 and the
 * console sends nothing.
 */

/** How long the session check may take before the event is given up. */
const SESSION_CHECK_TIMEOUT_MS = 3000;
const SALT_BYTES = 32;

const sessionAnswerSchema = z.object({ result: z.object({ data: z.object({ kind: z.enum(['operator', 'viewer']) }) }) });

/**
 * A salt that changes every UTC day and lives in this process's memory only,
 * so one day's visitor cannot be joined to the next day's.
 */
export function createDailySalt(today: () => Date = () => new Date()): () => Buffer {
  let held: { day: string; salt: Buffer } | undefined;
  return () => {
    const day = today().toISOString().slice(0, 'yyyy-mm-dd'.length);
    if (held?.day !== day) {
      held = { day, salt: randomBytes(SALT_BYTES) };
    }
    return held.salt;
  };
}

/** The anonymous visitor a session is today: an HMAC of its session cookie with the day's salt, never the cookie itself. */
export function distinctIdOf(sessionCookie: string, salt: Buffer): string {
  return createHmac('sha256', salt).update(sessionCookie).digest('hex');
}

export interface AnalyticsRouteDependencies {
  adapter: AnalyticsAdapter | undefined;
  serverUrl: string;
  salt: () => Buffer;
  fetchImplementation?: typeof fetch;
}

/** The session kind the server answers for the request's cookie; undefined for no live console session. */
async function sessionKindOf(cookieHeader: string, at: { serverUrl: string; fetchImplementation: typeof fetch }): Promise<SessionKind | undefined> {
  try {
    const answer = await at.fetchImplementation(`${at.serverUrl}/trpc/console.session`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
      signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS),
    });
    return answer.ok ? sessionAnswerSchema.safeParse(await answer.json()).data?.result.data.kind : undefined;
  } catch {
    return undefined;
  }
}

function sessionCookieValue(cookieHeader: string): string | undefined {
  return cookieHeader
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([name]) => name === SESSION_COOKIE)?.[1];
}

export async function handleAnalytics(request: Request, dependencies: AnalyticsRouteDependencies): Promise<Response> {
  const { adapter, serverUrl, salt, fetchImplementation = fetch } = dependencies;
  if (adapter === undefined) {
    return new Response(null, { status: 404 });
  }
  const event = analyticsEventSchema.safeParse(await request.json().catch(() => undefined));
  if (!event.success) {
    return new Response(null, { status: 400 });
  }
  const cookieHeader = request.headers.get('cookie') ?? '';
  const sessionCookie = sessionCookieValue(cookieHeader);
  const sessionKind = sessionCookie === undefined ? undefined : await sessionKindOf(cookieHeader, { serverUrl, fetchImplementation });
  if (sessionCookie === undefined || sessionKind === undefined) {
    return new Response(null, { status: 401 });
  }
  // The console never waits on analytics, and a provider that fails loses only this event.
  await adapter.capture(event.data, { distinctId: distinctIdOf(sessionCookie, salt()), sessionKind }).catch(() => undefined);
  return new Response(null, { status: 204 });
}
