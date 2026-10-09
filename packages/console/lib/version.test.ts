import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { trierarchPluginVersionOf, webVersion } from './version';

const SERVER = { server: '0.7.0', common: '0.7.0', migration: '20261001040000_lease_last_seen' };
const SQUADRONS = { squadrons: '0.11.0', migration: '20261003100000_formation_attempts', connectedFleets: 2, installation: 'enabled' };
const TRIERARCH_PLUGIN = { trierarchPlugin: '0.19.0', migration: '20261005090000_machines', connectedFleets: 1, installation: 'open' };

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

    await expect(webVersion({ AEOLUS_SERVER_INTERNAL_URL: server.url }, '0.7.0')).resolves.toEqual({ web: '0.7.0', server: { server: '0.7.0', common: '0.7.0' } });
  });

  it("passes on the server's own versions, so versions out of step show", async () => {
    const server = await aProcessAnswering(200, { server: '0.6.0', common: '0.6.0', migration: null });

    await expect(webVersion({ AEOLUS_SERVER_INTERNAL_URL: server.url }, '0.7.0')).resolves.toEqual({ web: '0.7.0', server: { server: '0.6.0', common: '0.6.0' } });
  });

  it('answers no server when it does not answer, or answers something else', async () => {
    const other = await aProcessAnswering(200, { fleets: 3 });
    const failing = await aProcessAnswering(502, SERVER);

    await expect(
      Promise.all([NOWHERE, other.url, failing.url].map((url) => webVersion({ AEOLUS_SERVER_INTERNAL_URL: url }, '0.7.0'))),
    ).resolves.toEqual([0, 1, 2].map(() => ({ web: '0.7.0', server: null })));
  });

  it('says nothing about the plugins the console has, and never asks them', async () => {
    const server = await aProcessAnswering(200, SERVER);
    const squadrons = await aProcessAnswering(200, SQUADRONS);
    const trierarchPlugin = await aProcessAnswering(200, TRIERARCH_PLUGIN);

    const answer = await webVersion({ AEOLUS_SERVER_INTERNAL_URL: server.url, AEOLUS_SQUADRONS_URL: squadrons.url, AEOLUS_TRIERARCH_PLUGIN_URL: trierarchPlugin.url }, '0.7.0');

    expect({ answer, pluginCalls: squadrons.calls() + trierarchPlugin.calls() }).toEqual({ answer: { web: '0.7.0', server: { server: '0.7.0', common: '0.7.0' } }, pluginCalls: 0 });
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
