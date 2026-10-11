import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { trierarchPluginVersionOf, webVersion } from './version';

const SERVER = { server: '0.7.0', common: '0.7.0', migration: '20261001040000_lease_last_seen' };
const SQUADRONS = { squadrons: '0.11.0', migration: '20261003100000_formation_attempts', connectedFleets: 2, installation: 'enabled' };
const TRIERARCH_PLUGIN = { trierarchPlugin: '0.19.0', migration: '20261005090000_machines', connectedFleets: 1, installation: 'open' };
const NETWORKING_PLUGIN = { networkingPlugin: '0.21.0' };

const OPERATOR_COOKIE = 'aeolus_session=ses_operator; theme=dark';
const VIEWER_COOKIE = 'aeolus_session=ses_viewer';
const ENDED_COOKIE = 'aeolus_session=ses_ended';

/** An address nothing listens on, so a call there fails. */
const NOWHERE = 'http://127.0.0.1:9';

const stopAll: (() => void)[] = [];
afterEach(() => {
  for (const stop of stopAll.splice(0)) {
    stop();
  }
});

/** A process answering its /api/version with the given status and body; it counts the calls it gets. */
async function aProcessAnswering(status: number, body: unknown): Promise<{ url: string; calls: () => number }> {
  let calls = 0;
  const server = createServer((_request, response) => {
    calls += 1;
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  stopAll.push(() => server.close());
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the stub process listens on no port');
  }
  return { url: `http://127.0.0.1:${String(address.port)}`, calls: () => calls };
}

describe('webVersion', () => {
  it("answers the web app's own version, from its package", async () => {
    const own = z.object({ version: z.string() }).parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')));
    const server = await aProcessAnswering(200, SERVER);

    await expect(webVersion({ AEOLUS_SERVER_INTERNAL_URL: server.url })).resolves.toMatchObject({ web: own.version });
  });

  it('answers only the versions the server runs, nothing else it says', async () => {
    const server = await aProcessAnswering(200, SERVER);

    await expect(webVersion({ AEOLUS_SERVER_INTERNAL_URL: server.url }, { web: '0.7.0' })).resolves.toEqual({ web: '0.7.0', server: { server: '0.7.0', common: '0.7.0' } });
  });

  it("passes on the server's own versions, so versions out of step show", async () => {
    const server = await aProcessAnswering(200, { server: '0.6.0', common: '0.6.0', migration: null });

    await expect(webVersion({ AEOLUS_SERVER_INTERNAL_URL: server.url }, { web: '0.7.0' })).resolves.toEqual({ web: '0.7.0', server: { server: '0.6.0', common: '0.6.0' } });
  });

  it('answers no server when it does not answer, or answers something else', async () => {
    const other = await aProcessAnswering(200, { fleets: 3 });
    const failing = await aProcessAnswering(502, SERVER);

    await expect(
      Promise.all([NOWHERE, other.url, failing.url].map((url) => webVersion({ AEOLUS_SERVER_INTERNAL_URL: url }, { web: '0.7.0' }))),
    ).resolves.toEqual([0, 1, 2].map(() => ({ web: '0.7.0', server: null })));
  });

  it('says nothing about the plugins the console has, and never asks them', async () => {
    const server = await aProcessAnswering(200, SERVER);
    const squadrons = await aProcessAnswering(200, SQUADRONS);
    const trierarchPlugin = await aProcessAnswering(200, TRIERARCH_PLUGIN);
    const networkingPlugin = await aProcessAnswering(200, NETWORKING_PLUGIN);

    const answer = await webVersion(
      {
        AEOLUS_SERVER_INTERNAL_URL: server.url,
        AEOLUS_SQUADRONS_URL: squadrons.url,
        AEOLUS_TRIERARCH_PLUGIN_URL: trierarchPlugin.url,
        AEOLUS_NETWORKING_PLUGIN_URL: networkingPlugin.url,
      },
      { web: '0.7.0' },
    );

    expect({ answer, pluginCalls: squadrons.calls() + trierarchPlugin.calls() + networkingPlugin.calls() }).toEqual({ answer: { web: '0.7.0', server: { server: '0.7.0', common: '0.7.0' } }, pluginCalls: 0 });
  });
});

/**
 * The server: its /api/version for anyone, and its `system.version` for the
 * operator's session alone, as fleet:manage; a viewer's session is refused
 * with 403, any other with 401.
 */
async function aServer(): Promise<{ url: string }> {
  const server = createServer((request, response) => {
    const cookie = request.headers.cookie ?? '';
    if (request.url === '/api/version') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ server: '0.7.0', common: '0.7.0' }));
      return;
    }
    if (request.url?.startsWith('/trpc/system.version') === true && cookie.includes('ses_operator')) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result: { data: SERVER } }));
      return;
    }
    response.writeHead(cookie.includes('ses_viewer') ? 403 : 401, { 'content-type': 'application/json' }).end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  stopAll.push(() => server.close());
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the stub server listens on no port');
  }
  return { url: `http://127.0.0.1:${String(address.port)}` };
}

describe('webVersion for a signed-in operator', () => {
  it("answers the server's latest migration beside its versions", async () => {
    const server = await aServer();

    await expect(webVersion({ AEOLUS_SERVER_INTERNAL_URL: server.url }, { cookie: OPERATOR_COOKIE, web: '0.7.0' })).resolves.toEqual({
      web: '0.7.0',
      server: { server: '0.7.0', common: '0.7.0', migration: '20261001040000_lease_last_seen' },
    });
  });

  it('answers the version of each plugin that runs, and nothing else a plugin says', async () => {
    const server = await aServer();
    const squadrons = await aProcessAnswering(200, SQUADRONS);
    const trierarchPlugin = await aProcessAnswering(200, TRIERARCH_PLUGIN);
    const networkingPlugin = await aProcessAnswering(200, NETWORKING_PLUGIN);

    const answer = await webVersion(
      {
        AEOLUS_SERVER_INTERNAL_URL: server.url,
        AEOLUS_SQUADRONS_URL: squadrons.url,
        AEOLUS_TRIERARCH_PLUGIN_URL: trierarchPlugin.url,
        AEOLUS_NETWORKING_PLUGIN_URL: networkingPlugin.url,
      },
      { cookie: OPERATOR_COOKIE, web: '0.7.0' },
    );

    expect(answer).toEqual({
      web: '0.7.0',
      server: { server: '0.7.0', common: '0.7.0', migration: '20261001040000_lease_last_seen' },
      squadrons: '0.11.0',
      trierarchPlugin: '0.19.0',
      networkingPlugin: '0.21.0',
    });
  });

  it('answers a plugin that runs but does not answer, or answers something else, without a version', async () => {
    const server = await aServer();
    const squadrons = await aProcessAnswering(502, SQUADRONS);
    const trierarchPlugin = await aProcessAnswering(200, { fleets: 3 });

    const answer = await webVersion(
      { AEOLUS_SERVER_INTERNAL_URL: server.url, AEOLUS_SQUADRONS_URL: squadrons.url, AEOLUS_TRIERARCH_PLUGIN_URL: trierarchPlugin.url, AEOLUS_NETWORKING_PLUGIN_URL: NOWHERE },
      { cookie: OPERATOR_COOKIE, web: '0.7.0' },
    );

    expect(answer).toMatchObject({ squadrons: null, trierarchPlugin: null, networkingPlugin: null });
  });

  it.each([
    ["a viewer's session", VIEWER_COOKIE],
    ['a session the server refuses', ENDED_COOKIE],
  ])('answers %s only the versions, and never asks a plugin', async (_label, cookie) => {
    const server = await aServer();
    const squadrons = await aProcessAnswering(200, SQUADRONS);

    const answer = await webVersion({ AEOLUS_SERVER_INTERNAL_URL: server.url, AEOLUS_SQUADRONS_URL: squadrons.url }, { cookie, web: '0.7.0' });

    expect({ answer, pluginCalls: squadrons.calls() }).toEqual({ answer: { web: '0.7.0', server: { server: '0.7.0', common: '0.7.0' } }, pluginCalls: 0 });
  });

  it('answers no server, and asks no plugin, when the server does not answer', async () => {
    const squadrons = await aProcessAnswering(200, SQUADRONS);

    const answer = await webVersion({ AEOLUS_SERVER_INTERNAL_URL: NOWHERE, AEOLUS_SQUADRONS_URL: squadrons.url }, { cookie: OPERATOR_COOKIE, web: '0.7.0' });

    expect({ answer, pluginCalls: squadrons.calls() }).toEqual({ answer: { web: '0.7.0', server: null }, pluginCalls: 0 });
  });
});

describe('trierarchPluginVersionOf', () => {
  it("reads the version from the trierarch plugin's own answer", () => {
    expect(trierarchPluginVersionOf(TRIERARCH_PLUGIN)).toBe('0.19.0');
  });

  it('is undefined for an answer that is something else', () => {
    expect([trierarchPluginVersionOf('Bad gateway'), trierarchPluginVersionOf(null)]).toEqual([undefined, undefined]);
  });
});
