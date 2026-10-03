import { squadronsUrlFrom } from '../../../../lib/squadrons-url';

// Answer every request fresh: squadrons' state changes.
export const dynamic = 'force-dynamic';

/**
 * The squadrons API for the browser, through the web app's server: the
 * browser never reaches squadrons, so these procedures go there server side
 * with the operator's console session cookie, which squadrons checks with the
 * fleet (decision 0017). Only the procedures the console uses pass; the
 * connection has its own route, which keeps the management secret server side.
 */
const QUERIES = new Set(['catalogue.list', 'squadrons.list', 'squadrons.messages']);
const MUTATIONS = new Set(['squadrons.form', 'squadrons.standDown', 'squadrons.forceStandDown', 'squadrons.addMember', 'squadrons.removeMember', 'catalogue.refresh']);

async function forward(request: Request, init: { procedure: string; method: 'GET' | 'POST'; search: string; body?: string }): Promise<Response> {
  const { procedure } = init;
  const squadronsUrl = squadronsUrlFrom(process.env);
  if (squadronsUrl === undefined) {
    return Response.json(
      {
        error: {
          message: 'This console has no squadrons',
          data: { code: 'NOT_FOUND' },
        },
      },
      { status: 404 },
    );
  }
  const headers: Record<string, string> = {
    cookie: request.headers.get('cookie') ?? '',
  };
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  try {
    const answer = await fetch(`${squadronsUrl}/trpc/${procedure}${init.search}`, {
      method: init.method,
      headers,
      body: init.body,
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    return new Response(await answer.text(), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return Response.json(
      {
        error: {
          message: 'squadrons did not answer: try again in a moment',
          data: { code: 'BAD_GATEWAY' },
        },
      },
      { status: 502 },
    );
  }
}

export async function GET(request: Request, context: { params: Promise<{ procedure: string }> }): Promise<Response> {
  const { procedure } = await context.params;
  if (!QUERIES.has(procedure)) {
    return Response.json(
      {
        error: {
          message: 'No such squadrons query',
          data: { code: 'NOT_FOUND' },
        },
      },
      { status: 404 },
    );
  }
  return forward(request, {
    procedure,
    method: 'GET',
    search: new URL(request.url).search,
  });
}

export async function POST(request: Request, context: { params: Promise<{ procedure: string }> }): Promise<Response> {
  const { procedure } = await context.params;
  if (!MUTATIONS.has(procedure)) {
    return Response.json(
      {
        error: {
          message: 'No such squadrons mutation',
          data: { code: 'NOT_FOUND' },
        },
      },
      { status: 404 },
    );
  }
  return forward(request, {
    procedure,
    method: 'POST',
    search: '',
    body: await request.text(),
  });
}
