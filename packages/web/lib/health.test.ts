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
});
