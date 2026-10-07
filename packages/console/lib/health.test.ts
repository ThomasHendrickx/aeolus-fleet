import { describe, expect, it } from 'vitest';

import { webHealth } from './health';

const serverSays = (status: number, body: unknown) => () => Promise.resolve(Response.json(body, { status }));

describe('webHealth', () => {
  it('is healthy when the server and its database are up', async () => {
    await expect(webHealth(serverSays(200, { server: 'up', database: 'up' }))).resolves.toEqual({
      isHealthy: true,
      body: { web: 'up', server: 'up', database: 'up' },
    });
  });

  it('is not healthy when the database is down', async () => {
    await expect(webHealth(serverSays(503, { server: 'up', database: 'down' }))).resolves.toEqual({
      isHealthy: false,
      body: { web: 'up', server: 'up', database: 'down' },
    });
  });

  it('is not healthy when the server does not answer', async () => {
    await expect(webHealth(() => Promise.reject(new TypeError('fetch failed')))).resolves.toEqual({
      isHealthy: false,
      body: { web: 'up', server: 'down', database: 'unknown' },
    });
  });

  it('passes on nothing else the server says', async () => {
    const { body } = await webHealth(serverSays(200, { server: 'up', database: 'up', fleets: 3 }));

    expect(Object.keys(body)).toEqual(['web', 'server', 'database']);
  });

  it('adds squadrons, up with its connected fleets and installation, when the console has squadrons', async () => {
    await expect(webHealth(serverSays(200, { server: 'up', database: 'up' }), { fetchSquadronsHealth: serverSays(200, { status: 'ok', connectedFleets: 0, installation: 'open' }) })).resolves.toEqual({
      isHealthy: true,
      body: { web: 'up', server: 'up', database: 'up', squadrons: { status: 'up', connectedFleets: 0, installation: 'open' } },
    });
  });

  it('shows squadrons down as its own part and stays healthy when squadrons does not answer', async () => {
    await expect(webHealth(serverSays(200, { server: 'up', database: 'up' }), { fetchSquadronsHealth: () => Promise.reject(new TypeError('fetch failed')) })).resolves.toEqual({
      isHealthy: true,
      body: { web: 'up', server: 'up', database: 'up', squadrons: { status: 'down' } },
    });
  });

  it("shows squadrons down when its database is unreachable", async () => {
    const { body } = await webHealth(serverSays(200, { server: 'up', database: 'up' }), { fetchSquadronsHealth: serverSays(503, { status: 'unavailable' }) });

    expect(body.squadrons).toEqual({ status: 'down' });
  });

  it('adds the trierarch plugin as its own part when the console has it, and stays healthy when it is down', async () => {
    const up = await webHealth(serverSays(200, { server: 'up', database: 'up' }), {
      fetchTrierarchPluginHealth: serverSays(200, { status: 'ok', connectedFleets: 1, installation: 'enabled' }),
    });
    const down = await webHealth(serverSays(200, { server: 'up', database: 'up' }), { fetchTrierarchPluginHealth: () => Promise.reject(new TypeError('fetch failed')) });

    expect(up.body.trierarchPlugin).toEqual({ status: 'up', connectedFleets: 1, installation: 'enabled' });
    expect(down).toEqual({ isHealthy: true, body: { web: 'up', server: 'up', database: 'up', trierarchPlugin: { status: 'down' } } });
  });
});
