import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import type { UseCases } from '../trpc/context.js';
import { appRouter, type AppRouter } from '../trpc/router.js';

export interface HttpServerOptions {
  useCases: UseCases;
  /** Throws when the database is unreachable. */
  checkDatabase: () => Promise<void>;
  logger: FastifyServerOptions['logger'];
}

/**
 * The HTTP host: `/trpc` for the API and `/health` for monitoring. REST
 * (`/api/v1`) and MCP (`/mcp`) are mounted here once they exist.
 */
export function buildHttpServer(options: HttpServerOptions): FastifyInstance {
  const server = Fastify({
    logger: options.logger ?? false,
    // tRPC batches several procedure paths into one URL segment.
    routerOptions: { maxParamLength: 5000 },
  });

  server.get('/health', async (_request, reply) => {
    try {
      await options.checkDatabase();
      return { status: 'ok' };
    } catch (error) {
      server.log.error({ reason: error instanceof Error ? error.message : 'unknown' }, 'health check failed');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  const trpc: FastifyTRPCPluginOptions<AppRouter> = {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: () => ({ useCases: options.useCases }),
      onError: ({ path, error }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          server.log.error({ path, reason: error.message }, 'procedure failed');
        }
      },
    },
  };
  void server.register(fastifyTRPCPlugin, trpc);

  return server;
}
