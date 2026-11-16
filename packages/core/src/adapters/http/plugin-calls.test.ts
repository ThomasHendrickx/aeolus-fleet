import { createServer, type Server, type RequestListener } from 'node:http';

import type { PluginCallContext } from '@aeolus-fleet/common';
import { afterEach, describe, expect, it } from 'vitest';

import { createHttpPluginCalls } from './plugin-calls.js';

const context: PluginCallContext = { requestId: 'f473fb19-52cd-445f-906b-7d6ef5e4b01f', fleetId: 'flt_00000000000000000000000001', pluginShipId: 'shp_00000000000000000000000002', actor: { kind: 'installation' }, scopes: [], procedure: 'widgets.change', input: { private: 'never in errors' }, expiresAt: new Date(Date.now() + 30_000).toISOString() };
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => { resolve(); }); }))); });
async function endpoint(handle: RequestListener) {
  const server = createServer(handle);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test listener');
  return { server, url: `http://127.0.0.1:${String(address.port)}/internal/plugin-context` };
}
const target = (url: string) => ({ fleetId: context.fleetId, pluginShipId: context.pluginShipId, url, secret: 'plugin-transport-test-shared-secret' });

describe('plugin actor contract slice 1: configured server transport', () => {
  it('dispatches once with the shared secret and returns plugin data', async () => {
    // Given an internal configured plugin endpoint.
    const received: unknown[] = [];
    const plugin = await endpoint((request, response) => {
      received.push(request.headers['aeolus-plugin-secret']);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ result: { data: { version: 1 } } }));
    });
    // When core dispatches the authenticated context.
    const answer = await createHttpPluginCalls({ targets: [target(plugin.url)], now: () => new Date() }).dispatch(context);
    // Then the operation's data returns and only one dispatch occurs.
    expect(answer).toEqual({ isOk: true, value: { version: 1 } });
    expect(received).toEqual(['plugin-transport-test-shared-secret']);
  });

  it('refuses redirects without contacting the redirected endpoint', async () => {
    // Given a configured endpoint redirecting to another server.
    const hits: string[] = [];
    const other = await endpoint((_request, response) => { hits.push('other'); response.end('{}'); });
    const plugin = await endpoint((_request, response) => { response.writeHead(307, { location: other.url }); response.end(); });
    // When core dispatches.
    const answer = await createHttpPluginCalls({ targets: [target(plugin.url)], now: () => new Date() }).dispatch(context);
    // Then no redirect is followed and the error describes uncertainty safely.
    expect(answer.isOk).toBe(false);
    if (!answer.isOk) {
      expect(answer.error.code).toBe('BAD_GATEWAY');
      expect(answer.error.message).toContain('outcome unknown');
    }
    expect(hits).toEqual([]);
    expect(JSON.stringify(answer)).not.toContain('never in errors');
  });

  it('reports outcome unknown after commit and lost answer, never retries', async () => {
    // Given a plugin that commits then disconnects.
    let version = 0;
    const plugin = await endpoint((request) => { version += 1; request.socket.destroy(); });
    // When the answer is lost.
    const answer = await createHttpPluginCalls({ targets: [target(plugin.url)], now: () => new Date() }).dispatch(context);
    // Then the committed state exists but core makes no second attempt.
    expect(version).toBe(1);
    expect(answer.isOk).toBe(false);
    if (!answer.isOk) {
      expect(answer.error.code).toBe('BAD_GATEWAY');
      expect(answer.error.message).toContain('outcome unknown');
    }
    expect(JSON.stringify(answer)).not.toContain('never in errors');
  });

  it('reports no operation started when no target is configured or its context already expired', async () => {
    // Given no deployment target.
    const transport = createHttpPluginCalls({ targets: [], now: () => new Date(context.expiresAt) });
    // When an immediate dispatch cannot begin.
    const answer = await transport.dispatch(context);
    // Then core does not claim a plugin operation started.
    expect(answer.isOk).toBe(false);
    if (!answer.isOk) {
      expect(answer.error.code).toBe('NOT_FOUND');
      expect(answer.error.message).toContain('no operation started');
    }
  });
});
