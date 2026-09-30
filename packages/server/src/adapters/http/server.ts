import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import type { Clock } from '../../core/shared/clock.js';
import type { Context, UseCases } from '../trpc/context.js';
import { appRouter, type AppRouter } from '../trpc/router.js';
import { createRateLimiter, type RateLimit } from './rate-limiter.js';
import { clearedSessionCookie, readBearer, readSessionToken, sessionCookie } from './request-credentials.js';

/** Ten sign-in attempts per client per minute. */
export const DEFAULT_SIGN_IN_RATE_LIMIT: RateLimit = { limit: 10, windowMs: 60_000 };

/** Ten register attempts per client per minute, as for sign-in (ADR 0015). */
export const DEFAULT_REGISTER_RATE_LIMIT: RateLimit = { limit: 10, windowMs: 60_000 };

export interface HttpServerOptions {
  useCases: UseCases;
  /** Throws when the database is unreachable. */
  checkDatabase: () => Promise<void>;
  clock: Clock;
  logger: FastifyServerOptions['logger'];
  /** Trust X-Forwarded-For from a reverse proxy in front of the server, for the client address. */
  shouldTrustProxy?: boolean;
  signInRateLimit?: RateLimit;
  registerRateLimit?: RateLimit;
  /** The domain the session cookie is set for. Unset: the server's host only. */
  cookieDomain?: string;
  /** The origin of a console on another host, allowed to call with credentials. Unset: none. */
  consoleOrigin?: string;
}

/** How long a browser may keep the answer to a preflight, in seconds. */
const PREFLIGHT_MAX_AGE_S = 600;

/**
 * The HTTP host: `/trpc` for the API and `/health` for monitoring. REST
 * (`/api/v1`) and MCP (`/mcp`) are mounted here once they exist.
 */
export function buildHttpServer(options: HttpServerOptions): FastifyInstance {
  const server = Fastify({
    logger: options.logger ?? false,
    trustProxy: options.shouldTrustProxy ?? false,
    // tRPC batches several procedure paths into one URL segment.
    routerOptions: { maxParamLength: 5000 },
  });

  const signInLimiter = createRateLimiter(options.signInRateLimit ?? DEFAULT_SIGN_IN_RATE_LIMIT, options.clock);
  const registerLimiter = createRateLimiter(options.registerRateLimit ?? DEFAULT_REGISTER_RATE_LIMIT, options.clock);
  const { consoleOrigin, cookieDomain } = options;

  // The console may run on another host under the cookie's domain (ADR 0012).
  // Its origin, and no other, may call with credentials and read the answer.
  if (consoleOrigin !== undefined) {
    server.addHook('onRequest', async (request, reply) => {
      void reply.header('vary', 'Origin');
      if (request.headers.origin !== consoleOrigin) {
        return;
      }
      void reply.header('access-control-allow-origin', consoleOrigin);
      void reply.header('access-control-allow-credentials', 'true');
      if (request.method === 'OPTIONS') {
        await reply
          .code(204)
          .header('access-control-allow-methods', 'GET, POST')
          .header('access-control-allow-headers', 'content-type')
          .header('access-control-max-age', String(PREFLIGHT_MAX_AGE_S))
          .send();
      }
    });
  }

  // Server up and database reachable. Nothing about fleets.
  server.get('/health', async (_request, reply) => {
    try {
      await options.checkDatabase();
      return { server: 'up', database: 'up' };
    } catch (error) {
      server.log.error({ reason: error instanceof Error ? error.message : 'unknown' }, 'health check failed');
      return reply.code(503).send({ server: 'up', database: 'down' });
    }
  });

  const trpc: FastifyTRPCPluginOptions<AppRouter> = {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: ({ req, res }): Context => ({
        useCases: options.useCases,
        credentials: {
          bearer: readBearer(req.headers.authorization),
          sessionToken: readSessionToken(req.headers.cookie),
        },
        sessionCookie: {
          set: (token, expiresAt) => {
            void res.header('set-cookie', sessionCookie({ token, expiresAt, now: options.clock.now(), domain: cookieDomain }));
          },
          clear: () => {
            void res.header('set-cookie', clearedSessionCookie(cookieDomain));
          },
        },
        clientKey: req.ip,
        takeSignInAttempt: (clientKey) => signInLimiter.take(clientKey),
        takeRegisterAttempt: (clientKey) => registerLimiter.take(clientKey),
      }),
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
