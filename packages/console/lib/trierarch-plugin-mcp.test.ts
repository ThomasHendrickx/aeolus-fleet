import { describe, expect, it } from 'vitest';

import { forwardMcpCall } from './trierarch-plugin-mcp';

const ENVIRONMENT = { AEOLUS_TRIERARCH_PLUGIN_URL: 'https://plugin.example/' };
const CONSOLE_ORIGIN = 'https://console.example';
const COOKIE = 'aeolus_session=operator; theme=dark; aeolus_account_token=account';
const SIGN_IN_COOKIES = 'aeolus_session=operator; aeolus_account_token=account';
const REPLACEMENT = '{"expectedVersion":0,"servers":[],"secrets":["graph"],"secretValues":{"graph":"Bearer kept-out"}}';

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** The trierarch plugin as a fake: records what reached it and answers as given. */
function aPlugin(answer: () => Promise<Response>): { sent: Sent[]; fetch: typeof fetch } {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: async (input, init) => {
      sent.push({
        url: input instanceof Request ? input.url : input.toString(),
        method: init?.method ?? 'GET',
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return answer();
    },
  };
}

function aRequest(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Request {
  return new Request(`${CONSOLE_ORIGIN}${path}`, init);
}

describe('the console route forwards mcp.get and mcp.replace to the trierarch plugin', () => {
  it('forwards mcp.get with the caller console session and Origin, and answers the plugin answer as it is', async () => {
    // Given a trierarch plugin that answers the fleet's MCP configuration.
    const configuration = { result: { data: { version: 3, servers: [], secrets: ['graph'] } } };
    const plugin = aPlugin(() => Promise.resolve(Response.json(configuration)));

    // When a signed-in manager reads it through the console, with other headers too.
    const response = await forwardMcpCall(aRequest('/api/trierarch-plugin/mcp.get', { headers: { cookie: COOKIE, origin: CONSOLE_ORIGIN, authorization: 'Bearer other', 'x-forwarded-for': '203.0.113.9' } }), {
      procedure: 'mcp.get',
      environment: ENVIRONMENT,
      fetchImplementation: plugin.fetch,
    });

    // Then the plugin got only the sign-in cookies and the Origin, and the caller gets its answer.
    expect(plugin.sent).toEqual([{ url: 'https://plugin.example/trpc/mcp.get', method: 'GET', headers: { cookie: SIGN_IN_COOKIES, origin: CONSOLE_ORIGIN }, body: undefined }]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(configuration);
  });

  it('forwards mcp.replace with the caller console session, Origin and body, and answers the plugin answer as it is', async () => {
    // Given a trierarch plugin that commits the replacement.
    const plugin = aPlugin(() => Promise.resolve(Response.json({ result: { data: { version: 1 } } })));

    // When a signed-in manager replaces the configuration through the console.
    const response = await forwardMcpCall(
      aRequest('/api/trierarch-plugin/mcp.replace', { method: 'POST', headers: { cookie: COOKIE, origin: CONSOLE_ORIGIN, 'content-type': 'application/json', authorization: 'Bearer other' }, body: REPLACEMENT }),
      { procedure: 'mcp.replace', environment: ENVIRONMENT, fetchImplementation: plugin.fetch },
    );

    // Then the plugin got the body unchanged with only the sign-in cookies, Origin and content type.
    expect(plugin.sent).toEqual([
      { url: 'https://plugin.example/trpc/mcp.replace', method: 'POST', headers: { cookie: SIGN_IN_COOKIES, origin: CONSOLE_ORIGIN, 'content-type': 'application/json' }, body: REPLACEMENT },
    ]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { data: { version: 1 } } });
  });

  it('answers the plugin refusal with its own status, and sends no Origin the caller did not send', async () => {
    // Given a trierarch plugin that refuses a change without the console's Origin.
    const refusal = { error: { message: 'Change the MCP configuration from the console', data: { code: 'FORBIDDEN', httpStatus: 403 } } };
    const plugin = aPlugin(() => Promise.resolve(Response.json(refusal, { status: 403 })));

    // When a caller replaces it without an Origin.
    const response = await forwardMcpCall(aRequest('/api/trierarch-plugin/mcp.replace', { method: 'POST', headers: { cookie: COOKIE, 'content-type': 'application/json' }, body: REPLACEMENT }), {
      procedure: 'mcp.replace',
      environment: ENVIRONMENT,
      fetchImplementation: plugin.fetch,
    });

    // Then no Origin was made up for it, and the caller gets the plugin's refusal.
    expect(plugin.sent[0]?.headers.origin).toBeUndefined();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(refusal);
  });

  it('answers 502 naming no value when the plugin does not answer', async () => {
    // Given a trierarch plugin that cannot be reached.
    const plugin = aPlugin(() => Promise.reject(new TypeError('fetch failed')));

    // When a manager replaces the configuration through the console.
    const response = await forwardMcpCall(aRequest('/api/trierarch-plugin/mcp.replace', { method: 'POST', headers: { cookie: COOKIE, origin: CONSOLE_ORIGIN, 'content-type': 'application/json' }, body: REPLACEMENT }), {
      procedure: 'mcp.replace',
      environment: ENVIRONMENT,
      fetchImplementation: plugin.fetch,
    });

    // Then the caller learns only that the plugin did not answer.
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: { message: 'The trierarch plugin did not answer: read mcp.get before replacing again' } });
    expect(body).not.toContain('kept-out');
  });

  it('answers 404 and forwards nothing on a console without the trierarch plugin', async () => {
    // Given a console with no trierarch plugin.
    const plugin = aPlugin(() => Promise.resolve(Response.json({})));

    // When a manager reads the configuration through it.
    const response = await forwardMcpCall(aRequest('/api/trierarch-plugin/mcp.get', { headers: { cookie: COOKIE, origin: CONSOLE_ORIGIN } }), { procedure: 'mcp.get', environment: {}, fetchImplementation: plugin.fetch });

    // Then nothing reached a plugin.
    expect(response.status).toBe(404);
    expect(plugin.sent).toEqual([]);
  });
});
