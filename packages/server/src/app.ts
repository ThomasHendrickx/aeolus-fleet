import type { FastifyInstance, FastifyServerOptions } from 'fastify';

import { buildHttpServer } from './adapters/http/server.js';
import { checkDatabase, createPrismaClient } from './adapters/prisma/client.js';
import { createPrismaFleetCounter } from './adapters/prisma/fleet-counter.js';
import type { Clock } from './core/shared/clock.js';
import { createPing } from './core/shared/ping.js';

export interface AppOptions {
  databaseUrl: string;
  clock?: Clock;
  logger?: FastifyServerOptions['logger'];
}

const systemClock: Clock = { now: () => new Date() };

/**
 * Wires adapters to use cases and returns the HTTP server, not yet listening.
 * Closing the server also disconnects the database.
 */
export function createApp(options: AppOptions): FastifyInstance {
  const prisma = createPrismaClient(options.databaseUrl);
  const clock = options.clock ?? systemClock;

  const server = buildHttpServer({
    useCases: {
      ping: createPing({ clock, fleets: createPrismaFleetCounter(prisma) }),
    },
    checkDatabase: () => checkDatabase(prisma),
    logger: options.logger,
  });

  server.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return server;
}
