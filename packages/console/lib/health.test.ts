import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { webHealth } from './health';

/** An address nothing listens on, so a call there fails. */
const NOWHERE = 'http://127.0.0.1:9';

const stopAll: (() => void)[] = [];
afterEach(() => {
  for (const stop of stopAll.splice(0)) {
    stop();
  }
});

/** A process answering its health with the given status and body; it counts the calls it gets. */
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

const serverUp = () => aProcessAnswering(200, { server: 'up', database: 'up' });

describe('webHealth', () => {
  it('is healthy when the server and its database are up', async () => {
    const server = await serverUp();

    await expect(webHealth({ AEOLUS_SERVER_INTERNAL_URL: server.url })).resolves.toEqual({
      isHealthy: true,
      body: { web: 'up', server: 'up', database: 'up' },
    });
  });

  it('is not healthy when the database is down', async () => {
    const server = await aProcessAnswering(503, { server: 'up', database: 'down' });

    await expect(webHealth({ AEOLUS_SERVER_INTERNAL_URL: server.url })).resolves.toEqual({
      isHealthy: false,
      body: { web: 'up', server: 'up', database: 'down' },
    });
  });

  it('is not healthy when the server does not answer', async () => {
    await expect(webHealth({ AEOLUS_SERVER_INTERNAL_URL: NOWHERE })).resolves.toEqual({
      isHealthy: false,
      body: { web: 'up', server: 'down', database: 'unknown' },
    });
  });

  it('passes on nothing else the server says', async () => {
    const server = await aProcessAnswering(200, { server: 'up', database: 'up', fleets: 3 });

    const { body } = await webHealth({ AEOLUS_SERVER_INTERNAL_URL: server.url });

    expect(Object.keys(body)).toEqual(['web', 'server', 'database']);
  });

  it('says nothing about plugins, and never asks them, even when the console has squadrons and the trierarch plugin', async () => {
    const server = await serverUp();
    const squadrons = await aProcessAnswering(200, { status: 'ok', connectedFleets: 2, installation: 'enabled' });
    const plugin = await aProcessAnswering(200, { status: 'ok', connectedFleets: 1, installation: 'open' });

    const health = await webHealth({ AEOLUS_SERVER_INTERNAL_URL: server.url, AEOLUS_SQUADRONS_URL: squadrons.url, AEOLUS_TRIERARCH_PLUGIN_URL: plugin.url });

    expect(health).toEqual({ isHealthy: true, body: { web: 'up', server: 'up', database: 'up' } });
    expect(squadrons.calls() + plugin.calls()).toBe(0);
  });
});
