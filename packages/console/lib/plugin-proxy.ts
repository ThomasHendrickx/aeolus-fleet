/**
 * What a plugin's proxy (app/api/squadrons/[procedure],
 * app/api/trierarch-plugin/[procedure]) lets through. It forwards the
 * operator's console session, so a mutation must come from the console
 * itself: a page on a sibling host shares the site, and SameSite does not
 * stop it from posting a form with the cookie.
 */

/** The console session cookie the fleet sets: the only cookie a plugin needs. */
const SESSION_COOKIE_NAME = 'aeolus_session';

/**
 * Why a mutation is refused, or undefined when it may pass: it must come from
 * the console's own origin (Sec-Fetch-Site same-origin, or without that header
 * an Origin equal to the console's) and carry JSON, which a plain form cannot.
 */
export function mutationRefusal(request: Request, plugin: string): string | undefined {
  const fetchSite = request.headers.get('sec-fetch-site');
  const isSameOrigin = fetchSite === null ? request.headers.get('origin') === new URL(request.url).origin : fetchSite === 'same-origin';
  if (!isSameOrigin) {
    return `${plugin.charAt(0).toUpperCase()}${plugin.slice(1)} changes come only from the console`;
  }
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    return `A ${plugin} change is sent as JSON`;
  }
  return undefined;
}

/** The request's cookie header down to the console session cookie, or empty without one. */
export function sessionCookieOf(cookieHeader: string | null): string {
  const session = (cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  return session ?? '';
}

const FORWARD_TIMEOUT_MS = 30_000;

/** A tRPC error answer, as the console's tRPC client reads it. */
function refused(status: number, error: { message: string; code: string }): Response {
  return Response.json({ error: { message: error.message, data: { code: error.code } } }, { status });
}

interface RouteContext {
  params: Promise<{ procedure: string }>;
}

/**
 * A plugin's API for the browser, through the web app's server: the browser
 * never reaches the plugin, so its procedures go there server side with the
 * operator's console session cookie, which the plugin checks with the fleet.
 * Only the procedures the console uses pass; the connection has its own
 * route, which keeps the plugin's secret server side. A mutation passes only
 * from the console, as JSON, and only the session cookie goes along.
 */
export function pluginProxy(plugin: { name: string; url: () => string | undefined; queries: ReadonlySet<string>; mutations: ReadonlySet<string> }) {
  const forward = async (request: Request, init: { procedure: string; method: 'GET' | 'POST'; search: string; body?: string }): Promise<Response> => {
    const url = plugin.url();
    if (url === undefined) {
      return refused(404, { message: `This console has no ${plugin.name}`, code: 'NOT_FOUND' });
    }
    const headers: Record<string, string> = { cookie: sessionCookieOf(request.headers.get('cookie')) };
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    try {
      const answer = await fetch(`${url}/trpc/${init.procedure}${init.search}`, {
        method: init.method,
        headers,
        body: init.body,
        cache: 'no-store',
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      });
      return new Response(await answer.text(), { status: answer.status, headers: { 'content-type': 'application/json' } });
    } catch {
      return refused(502, { message: `${plugin.name} did not answer: try again in a moment`, code: 'BAD_GATEWAY' });
    }
  };
  return {
    GET: async (request: Request, context: RouteContext): Promise<Response> => {
      const { procedure } = await context.params;
      if (!plugin.queries.has(procedure)) {
        return refused(404, { message: `No such ${plugin.name} query`, code: 'NOT_FOUND' });
      }
      return forward(request, { procedure, method: 'GET', search: new URL(request.url).search });
    },
    POST: async (request: Request, context: RouteContext): Promise<Response> => {
      const { procedure } = await context.params;
      if (!plugin.mutations.has(procedure)) {
        return refused(404, { message: `No such ${plugin.name} mutation`, code: 'NOT_FOUND' });
      }
      const refusal = mutationRefusal(request, plugin.name);
      if (refusal !== undefined) {
        return refused(403, { message: refusal, code: 'FORBIDDEN' });
      }
      return forward(request, { procedure, method: 'POST', search: '', body: await request.text() });
    },
  };
}
