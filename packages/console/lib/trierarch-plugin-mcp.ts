import { sessionCookieOf } from './plugin-call';
import { trierarchPluginUrlFrom } from './trierarch-plugin-url';

/**
 * The trierarch plugin's MCP configuration procedures as a manager reaches
 * them from outside, with no page (fleet crew MCP design, section 4; #1732):
 * `GET /api/trierarch-plugin/mcp.get` and `POST /api/trierarch-plugin/mcp.replace`.
 * The web app's server forwards only these two, with only the caller's console
 * sign-in cookies and the Origin it sent, never one made up, and for a
 * replacement its content type and body unchanged. The plugin checks the
 * session, scope and Origin, and its answer goes back as it is. The body holds
 * secret values: nothing here logs it or names it. A body over the plugin's own
 * limit is refused here, read no further than that.
 */

export type McpProcedure = 'mcp.get' | 'mcp.replace';

const TIMEOUT_MS = 30_000;

/** The plugin's request body limit: Fastify's default, which it keeps. */
const BODY_MAX_BYTES = 1_048_576;

const NO_ANSWER = { error: { message: 'The trierarch plugin did not answer: read mcp.get before replacing again' } };

const TOO_LARGE = { error: { message: 'The MCP configuration body is over 1 MiB' } };

export async function forwardMcpCall(
  request: Request,
  input: { procedure: McpProcedure; environment: Readonly<Record<string, string | undefined>>; fetchImplementation?: typeof fetch },
): Promise<Response> {
  const { procedure, environment, fetchImplementation = fetch } = input;
  const url = trierarchPluginUrlFrom(environment);
  if (url === undefined) {
    return new Response(null, { status: 404 });
  }
  const headers: Record<string, string> = { cookie: sessionCookieOf(request.headers.get('cookie')) };
  const origin = request.headers.get('origin');
  if (origin !== null) {
    headers.origin = origin;
  }
  const contentType = request.headers.get('content-type');
  const isReplacement = procedure === 'mcp.replace';
  if (isReplacement && contentType !== null) {
    headers['content-type'] = contentType;
  }
  const body = isReplacement ? await bodyWithin(request, BODY_MAX_BYTES) : undefined;
  if (body?.kind === 'tooLarge') {
    return Response.json(TOO_LARGE, { status: 413 });
  }
  let answer: Response;
  let answerText: string;
  try {
    answer = await fetchImplementation(`${url}/trpc/${procedure}`, {
      method: isReplacement ? 'POST' : 'GET',
      headers,
      ...(body === undefined ? {} : { body: body.text }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    answerText = await answer.text();
  } catch {
    return Response.json(NO_ANSWER, { status: 502 });
  }
  return new Response(answerText, { status: answer.status, headers: { 'content-type': answer.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
}

/** The request body as text, or tooLarge as soon as it passes the limit (leaving the loop cancels the rest), so an endless body is never held whole. */
async function bodyWithin(request: Request, maxBytes: number): Promise<{ kind: 'read'; text: string } | { kind: 'tooLarge' }> {
  if (request.body === null) {
    return { kind: 'read', text: '' };
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of request.body) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) {
      return { kind: 'tooLarge' };
    }
    chunks.push(chunk);
  }
  return { kind: 'read', text: new TextDecoder().decode(Buffer.concat(chunks)) };
}
