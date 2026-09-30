import { randomUUID } from 'node:crypto';

import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyServerOptions } from 'fastify';

import type { Clock } from '../../core/shared/clock.js';
import { registerMcpEndpoint } from '../mcp/mcp-endpoint.js';
import { registerRestApi } from '../rest/rest-api.js';
import type { Context, RequestCredentials, SessionCookie, UseCases } from '../trpc/context.js';
import { appRouter, type AppRouter } from '../trpc/router.js';
import { createRateLimiter, type RateLimit } from './rate-limiter.js';
import { clearedSessionCookie, readBearer, readSessionToken, sessionCookie } from './request-credentials.js';

/** Ten sign-in attempts per client per minute. */
export const DEFAULT_SIGN_IN_RATE_LIMIT: RateLimit = { limit: 10, windowMs: 60_000 };

/** Ten failed register attempts per client per minute; successful ones are never counted (ADR 0015). */
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
  /** Failed register attempts per client; successful ones are never counted. */
  registerRateLimit?: RateLimit;
  /** The domain the session cookie is set for. Unset: the server's host only. */
  cookieDomain?: string;
  /**
   * The console's origin: state-changing console calls come only from it, and
   * a console on another host may call from it with credentials (CORS).
   */
  consoleOrigin: string;
}

/** How long a browser may keep the answer to a preflight, in seconds. */
const PREFLIGHT_MAX_AGE_S = 600;

/**
 * The session cookie at a door for ships: REST and MCP never read the console
 * session, so they never set or clear its cookie either.
 */
const NO_SESSION_COOKIE: SessionCookie = { set: () => undefined, clear: () => undefined };

/**
 * The HTTP host: `/trpc` for the API, `/api/v1` (REST) and `/mcp` for ships,
 * and `/health` for monitoring. Every door builds its calls' context the same
 * way, so the register limit is one budget per client address across all of
 * them.
 */
export function buildHttpServer(options: HttpServerOptions): FastifyInstance {
  const server = Fastify({
    logger: options.logger ?? false,
    trustProxy: options.shouldTrustProxy ?? false,
    // Unique across restarts, so a caller's request id finds one log line.
    genReqId: () => randomUUID(),
    // tRPC batches several procedure paths into one URL segment.
    routerOptions: { maxParamLength: 5000 },
  });

  const signInLimiter = createRateLimiter(options.signInRateLimit ?? DEFAULT_SIGN_IN_RATE_LIMIT, options.clock);
  const registerFailures = createRateLimiter(options.registerRateLimit ?? DEFAULT_REGISTER_RATE_LIMIT, options.clock);
  const { consoleOrigin, cookieDomain } = options;

  // The console may run on another host under the cookie's domain (ADR 0012).
  // Its origin, and no other, may call with credentials and read the answer.
  // On the server's own origin the browser needs none of this, and ignores it.
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

  /** A call's context: who it says it is, how it may say so at this door, and where it came from. */
  const contextFor = (
    request: FastifyRequest,
    caller: { credentials: RequestCredentials; canUseConsoleSession: boolean; sessionCookie: SessionCookie },
  ): Context => ({
    useCases: options.useCases,
    ...caller,
    origin: request.headers.origin,
    consoleOrigin,
    clientKey: request.ip,
    requestId: request.id,
    takeSignInAttempt: (clientKey) => signInLimiter.take(clientKey),
    registerFailures,
  });

  const trpc: FastifyTRPCPluginOptions<AppRouter> = {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: ({ req, res }): Context =>
        contextFor(req, {
          credentials: {
            bearer: readBearer(req.headers.authorization),
            sessionToken: readSessionToken(req.headers.cookie),
          },
          canUseConsoleSession: true,
          sessionCookie: {
            set: (token, expiresAt) => {
              void res.header(
                'set-cookie',
                sessionCookie({ token, expiresAt, now: options.clock.now(), domain: cookieDomain }),
              );
            },
            clear: () => {
              void res.header('set-cookie', clearedSessionCookie(cookieDomain));
            },
          },
        }),
      // The whole failure goes to the log only, under the request's id (the
      // label Fastify's own request lines use); the answer carries that id.
      onError: ({ path, error, ctx }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          server.log.error({ reqId: ctx?.requestId, path, reason: error.message, stack: error.stack }, 'procedure failed');
        }
      },
    },
  };
  void server.register(fastifyTRPCPlugin, trpc);

  // The doors for ships: the credentials are the ones the call carries, never the console session.
  const shipDoor = {
    contextFor: (request: FastifyRequest, credentials: RequestCredentials) =>
      contextFor(request, { credentials, canUseConsoleSession: false, sessionCookie: NO_SESSION_COOKIE }),
  };
  registerRestApi(server, shipDoor);
  registerMcpEndpoint(server, shipDoor);

  return server;
}
