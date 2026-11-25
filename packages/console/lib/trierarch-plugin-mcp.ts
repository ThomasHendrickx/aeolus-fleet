import { TRIERARCH_PLUGIN_NO_ANSWER } from './no-answer';
import { sessionCookieOf } from './plugin-call';
import { trierarchPluginUrlFrom } from './trierarch-plugin-url';
import { guardAnswerSchemas } from './trierarch-plugin-guard-schemas';
import { mcpAnswerSchemas } from './trierarch-plugin-mcp-schemas';

/**
 * The trierarch plugin's MCP and guard configuration procedures as the console reaches them.
 * The web app's server forwards them with only the caller's console
 * sign-in cookies and the Origin it sent, never one made up, and for a
 * mutation its content type and body unchanged. The plugin checks the
 * session, scope and Origin, and its refusals go back as they are. Successful answers are parsed here
 * and projected to metadata or a committed version, never secret values. The body holds
 * secret values: nothing here logs it or names it. A body over the plugin's own
 * limit is refused here, read no further than that.
 */

const answerSchemas = { ...mcpAnswerSchemas, ...guardAnswerSchemas };
type ConfigurationProcedure = keyof typeof answerSchemas;

const TIMEOUT_MS = 30_000;

/** The plugin's request body limit: Fastify's default, which it keeps. */
const BODY_MAX_BYTES = 1_048_576;

const noAnswerMessages: Record<ConfigurationProcedure, string> = {
  'mcp.get': 'The trierarch plugin did not answer: read mcp.get before replacing again',
  'mcp.replace': 'The trierarch plugin did not answer: read mcp.get before replacing again',
  'guard.get': 'The trierarch plugin did not answer: read guard.get again',
  'guard.replace': 'The trierarch plugin did not answer: read guard.get before replacing again',
  'guard.update': TRIERARCH_PLUGIN_NO_ANSWER,
};

export async function forwardMcpCall(
  request: Request,
  input: { procedure: ConfigurationProcedure; environment: Readonly<Record<string, string | undefined>>; fetchImplementation?: typeof fetch },
): Promise<Response> {
  const { procedure, environment, fetchImplementation = fetch } = input;
  const noAnswer = { error: { message: noAnswerMessages[procedure] } };
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
  const isMutation = procedure === 'mcp.replace' || procedure === 'guard.replace' || procedure === 'guard.update';
  if (isMutation && contentType !== null) {
    headers['content-type'] = contentType;
  }
  const body = isMutation ? await bodyWithin(request, BODY_MAX_BYTES) : undefined;
  if (body?.kind === 'tooLarge') {
    const configuration = procedure.startsWith('guard.') ? 'guard' : 'MCP';
    return Response.json({ error: { message: `The ${configuration} configuration body is over 1 MiB` } }, { status: 413 });
  }
  let answer: Response;
  let answerText: string;
  try {
    answer = await fetchImplementation(`${url}/trpc/${procedure}`, {
      method: isMutation ? 'POST' : 'GET',
      headers,
      ...(body === undefined ? {} : { body: body.text }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    answerText = await answer.text();
    if (answer.ok) {
      const answerBody: unknown = JSON.parse(answerText);
      const parsed = answerSchemas[procedure].safeParse(answerBody);
      if (!parsed.success) return Response.json(noAnswer, { status: 502 });
      answerText = JSON.stringify(parsed.data);
    }
  } catch {
    return Response.json(noAnswer, { status: 502 });
  }
  return new Response(answerText, {
    status: answer.status,
    headers: { 'content-type': answer.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
  });
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
