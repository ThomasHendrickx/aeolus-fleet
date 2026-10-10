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

  it('adds squadrons, up with its connected fleets and installation, when the console has squadrons', async () => {
    const server = await serverUp();
    const squadrons = await aProcessAnswering(200, { status: 'ok', connectedFleets: 0, installation: 'open' });

    await expect(webHealth({ AEOLUS_SERVER_INTERNAL_URL: server.url, AEOLUS_SQUADRONS_URL: squadrons.url })).resolves.toEqual({
      isHealthy: true,
      body: { web: 'up', server: 'up', database: 'up', squadrons: { status: 'up', connectedFleets: 0, installation: 'open' } },
    });
  });

  it('shows squadrons down as its own part and stays healthy when squadrons does not answer', async () => {
    const server = await serverUp();

    await expect(webHealth({ AEOLUS_SERVER_INTERNAL_URL: server.url, AEOLUS_SQUADRONS_URL: NOWHERE })).resolves.toEqual({
      isHealthy: true,
      body: { web: 'up', server: 'up', database: 'up', squadrons: { status: 'down' } },
    });
  });

  it('adds the trierarch plugin as its own part when the console has it', async () => {
    const server = await serverUp();
    const plugin = await aProcessAnswering(200, { status: 'ok', connectedFleets: 1, installation: 'enabled' });

    const { body } = await webHealth({ AEOLUS_SERVER_INTERNAL_URL: server.url, AEOLUS_TRIERARCH_PLUGIN_URL: plugin.url });

    expect(body.trierarchPlugin).toEqual({ status: 'up', connectedFleets: 1, installation: 'enabled' });
  });
});
