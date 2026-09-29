import { afterEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { buildHttpServer } from './server.js';

const ping = () => Promise.resolve({ serverTime: new Date('2026-09-29T12:00:00.000Z'), fleetCount: 2 });
const reachable = () => Promise.resolve();
const unreachable = () => Promise.reject(new Error('connect ECONNREFUSED'));

describe('http server', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
  });

  it('reports ok on /health when the database answers', async () => {
    server = buildHttpServer({ useCases: { ping }, checkDatabase: reachable, logger: false });

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('reports 503 on /health when the database does not answer', async () => {
    server = buildHttpServer({ useCases: { ping }, checkDatabase: unreachable, logger: false });

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable' });
  });

  it('serves system.ping under /trpc with the time as ISO 8601', async () => {
    server = buildHttpServer({ useCases: { ping }, checkDatabase: reachable, logger: false });

    const response = await server.inject({ method: 'GET', url: '/trpc/system.ping' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      result: { data: { serverTime: '2026-09-29T12:00:00.000Z', fleetCount: 2 } },
    });
  });

  it('answers 500 on system.ping when the use case fails', async () => {
    const failingPing = () => Promise.reject(new Error('database unreachable'));
    server = buildHttpServer({ useCases: { ping: failingPing }, checkDatabase: reachable, logger: false });

    const response = await server.inject({ method: 'GET', url: '/trpc/system.ping' });

    expect(response.statusCode).toBe(500);
  });
});
