import type { FastifyInstance, FastifyServerOptions } from 'fastify';

import type { RateLimit } from './adapters/http/rate-limiter.js';
import { buildHttpServer } from './adapters/http/server.js';
import { checkDatabase, createPrismaClient } from './adapters/prisma/client.js';
import type { Clock } from './core/shared/clock.js';
import { createUseCases, systemClock } from './wiring.js';

export interface AppOptions {
  databaseUrl: string;
  /** Where ships reach the fleet: the fleet URL every starting prompt carries. */
  publicUrl: string;
  clock?: Clock;
  logger?: FastifyServerOptions['logger'];
  shouldTrustProxy?: boolean;
  signInRateLimit?: RateLimit;
  /** The domain the session cookie is set for. Unset: the server's host only. */
  cookieDomain?: string;
  /** The origin of a console on another host, allowed to call with credentials. Unset: none. */
  consoleOrigin?: string;
}

/**
 * Wires adapters to use cases and returns the HTTP server, not yet listening.
 * Closing the server also disconnects the database.
 */
export function createApp(options: AppOptions): FastifyInstance {
  const prisma = createPrismaClient(options.databaseUrl);
  const clock = options.clock ?? systemClock;

  const server = buildHttpServer({
    useCases: createUseCases({ prisma, clock, fleetUrl: options.publicUrl }),
    checkDatabase: () => checkDatabase(prisma),
    clock,
    logger: options.logger,
    shouldTrustProxy: options.shouldTrustProxy,
    signInRateLimit: options.signInRateLimit,
    cookieDomain: options.cookieDomain,
    consoleOrigin: options.consoleOrigin,
  });

  server.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return server;
}
