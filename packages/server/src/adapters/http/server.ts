import { randomUUID } from 'node:crypto';

import fastifyWebsocket from '@fastify/websocket';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import { getWSConnectionHandler, handleKeepAlive } from '@trpc/server/adapters/ws';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest, type FastifyServerOptions } from 'fastify';

import type { Clock } from '../../core/shared/clock.js';
import { registerMcpEndpoint } from '../mcp/mcp-endpoint.js';
import { createFleetEventWakeups } from '../prisma/fleet-event-wakeups.js';
import { failureForLog } from '../prisma/failure-log.js';
import { registerRestApi } from '../rest/rest-api.js';
import type { Context, FleetEventWatches, RequestCredentials, SessionCookie, UseCases } from '../trpc/context.js';
import { appRouter, type AppRouter } from '../trpc/router.js';
import { refusalBody, unexpectedFailure } from '../trpc/ship-contract.js';
import { createRateLimiter, type RateLimit } from './rate-limiter.js';
import { clearedSessionCookie, readBearer, readSessionToken, sessionCookie } from './request-credentials.js';
import { runningVersions } from './version.js';
import { INSTALLATION_TOKEN_HEADER } from '../trpc/installation.js';

/** A header's one value: a header sent twice counts as not sent. */
function headerValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Ten sign-in attempts per client per minute. */
export const DEFAULT_SIGN_IN_RATE_LIMIT: RateLimit = { limit: 10, windowMs: 60_000 };

/** Ten failed register attempts per client per minute; successful ones are never counted (ADR 0015). */
export const DEFAULT_REGISTER_RATE_LIMIT: RateLimit = { limit: 10, windowMs: 60_000 };

export interface HttpServerOptions {
  useCases: UseCases;
  /**
   * Wakes live subscriptions when their fleet commits events. The app feeds
   * them from the listener; unset, a subscription hears only what it reads
   * when it starts.
   */
  fleetEvents?: FleetEventWatches;
  /** Throws when the database is unreachable. */
  checkDatabase: () => Promise<void>;
  /** The latest migration applied to the database; null before the first. Throws when unreachable. */
  latestMigration: () => Promise<string | null>;
  clock: Clock;
  logger: FastifyServerOptions['logger'];
  /** Trust X-Forwarded-For from a reverse proxy in front of the server, for the client address. */
  shouldTrustProxy?: boolean;
  signInRateLimit?: RateLimit;
  /** Failed register attempts per client; successful ones are never counted. */
  registerRateLimit?: RateLimit;
  /** The domain the session cookie is set for. Unset: the server's host only. */
  cookieDomain?: string;
  /** Where ships reach the fleet, the public URL: what starting prompts and crew lines carry. */
  fleetUrl: string;
  /** The installation token that opens the installation procedures; unset, they are off. */
  installationToken?: string;
  /**
   * The console's origin: state-changing console calls come only from it, and
   * a console on another host may call from it with credentials (CORS).
   */
  consoleOrigin: string;
}

/**
 * Refusals Fastify raises itself, before any route runs, by its error code:
 * our code and words, never Fastify's, whose messages may echo the request.
 */
const FASTIFY_REFUSALS: Readonly<Record<string, { httpStatus: number; code: string; message: string }>> = {
  FST_ERR_CTP_INVALID_JSON_BODY: { httpStatus: 400, code: 'BAD_REQUEST', message: 'The request body is not valid JSON' },
  FST_ERR_CTP_EMPTY_JSON_BODY: { httpStatus: 400, code: 'BAD_REQUEST', message: 'The request body is not valid JSON' },
  FST_ERR_CTP_BODY_TOO_LARGE: { httpStatus: 413, code: 'PAYLOAD_TOO_LARGE', message: 'The request body is over 1 MiB' },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: {
    httpStatus: 415,
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'The request body must be JSON',
  },
};

/** Any other request Fastify cannot read. */
const UNREADABLE_REQUEST = { httpStatus: 400, code: 'BAD_REQUEST', message: 'The request cannot be read' };

/**
 * How often the server pings a live subscription's socket, and how long it
 * waits for the pong before it closes it: a browser that went away without a
 * word frees its subscription within a minute.
 */
const KEEP_ALIVE = { pingMs: 30_000, pongWaitMs: 10_000 };

/** Fastify's own limit on a request body, which its refusal above names: 1 MiB. */
const BODY_LIMIT_BYTES = 1024 * 1024;

/** How long a browser may keep the answer to a preflight, in seconds. */
const PREFLIGHT_MAX_AGE_S = 600;

/**
 * The session cookie at a door for ships: REST and MCP never read the console
 * session, so they never set or clear its cookie either.
 */
const NO_SESSION_COOKIE: SessionCookie = { set: () => undefined, clear: () => undefined };

/**
 * The HTTP host: `/trpc` for the API (its subscriptions over a WebSocket on
 * the same path), `/api/v1` (REST) and `/mcp` for ships, and `/health` for
 * monitoring. Every door builds its calls' context the same
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
    bodyLimit: BODY_LIMIT_BYTES,
  });

  // Set first, so every door inherits it. A route's own failures are its own
  // to answer; what reaches this is an error Fastify raised itself.
  // eslint-disable-next-line @typescript-eslint/max-params -- Fastify calls its error handler with three arguments.
  server.setErrorHandler(async (error: FastifyError, request, reply) => {
    const isRefusal = error.statusCode !== undefined && error.statusCode < 500;
    const refusal = FASTIFY_REFUSALS[error.code] ?? (isRefusal ? UNREADABLE_REQUEST : undefined);
    if (refusal !== undefined) {
      return reply.code(refusal.httpStatus).send({ code: refusal.code, message: refusal.message });
    }
    const failure = unexpectedFailure(error, { log: request.log, requestId: request.id });
    return reply.code(failure.httpStatus).send(refusalBody(failure));
  });

  server.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({ code: 'NOT_FOUND', message: 'Nothing is served at this path' }),
  );

  const signInLimiter = createRateLimiter(options.signInRateLimit ?? DEFAULT_SIGN_IN_RATE_LIMIT, options.clock);
  const registerFailures = createRateLimiter(options.registerRateLimit ?? DEFAULT_REGISTER_RATE_LIMIT, options.clock);
  const { consoleOrigin, cookieDomain } = options;
  const fleetEvents = options.fleetEvents ?? createFleetEventWakeups();

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

  // The versions this process runs and the database's latest migration, for
  // whoever operates the installation. No authentication, no fleet data.
  const versions = runningVersions();
  server.get('/api/version', async () => {
    let migration: string | null = null;
    try {
      migration = await options.latestMigration();
    } catch (error) {
      server.log.error(failureForLog(error), 'latest migration unknown');
    }
    return { ...versions, migration };
  });

  // Server up and database reachable. Nothing about fleets.
  server.get('/health', async (_request, reply) => {
    try {
      await options.checkDatabase();
      return { server: 'up', database: 'up' };
    } catch (error) {
      server.log.error(failureForLog(error), 'health check failed');
      return reply.code(503).send({ server: 'up', database: 'down' });
    }
  });

  /** A call's context: who it says it is, how it may say so at this door, and where it came from. */
  const contextFor = (
    request: Pick<FastifyRequest, 'headers' | 'ip' | 'id' | 'log'>,
    caller: { credentials: RequestCredentials; canUseConsoleSession: boolean; sessionCookie: SessionCookie },
  ): Context => ({
    useCases: options.useCases,
    fleetUrl: options.fleetUrl,
    installation: { configured: options.installationToken, presented: headerValue(request.headers[INSTALLATION_TOKEN_HEADER]) },
    log: request.log,
    fleetEvents,
    ...caller,
    userAgent: request.headers['user-agent'],
    origin: request.headers.origin,
    consoleOrigin,
    clientKey: request.ip,
    requestId: request.id,
    takeSignInAttempt: (clientKey) => signInLimiter.take(clientKey),
    signInRetryAt: (clientKey) => signInLimiter.retryAt(clientKey),
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
          server.log.error({ reqId: ctx?.requestId, path, ...failureForLog(error) }, 'procedure failed');
        }
      },
    },
  };
  void server.register(fastifyTRPCPlugin, trpc);

  // Live subscriptions: one WebSocket per console, opened on /trpc with the
  // session cookie and the page's Origin, both of which a browser sends on
  // the upgrade. Nothing can set a cookie on a socket, so the session's
  // renewal waits for the console's next HTTP call.
  void server.register(async (scope) => {
    await scope.register(fastifyWebsocket);
    const onConnection = getWSConnectionHandler<AppRouter>({
      router: appRouter,
      wss: scope.websocketServer,
      createContext: ({ req }) =>
        contextFor(
          {
            headers: req.headers,
            ip: req.socket.remoteAddress ?? '',
            id: randomUUID(),
            log: server.log,
          },
          {
            credentials: { sessionToken: readSessionToken(req.headers.cookie) },
            canUseConsoleSession: true,
            sessionCookie: NO_SESSION_COOKIE,
          },
        ),
      onError: ({ path, error, ctx }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          server.log.error({ reqId: ctx?.requestId, path, ...failureForLog(error) }, 'subscription failed');
        }
      },
    });
    scope.get('/trpc', { websocket: true }, (socket, request) => {
      onConnection(socket, request.raw);
      handleKeepAlive(socket, KEEP_ALIVE.pingMs, KEEP_ALIVE.pongWaitMs);
    });
  });

  // The doors for ships: the credentials are the ones the call carries, never the console session.
  const shipDoor = {
    contextFor: (request: FastifyRequest, credentials: RequestCredentials) =>
      contextFor(request, { credentials, canUseConsoleSession: false, sessionCookie: NO_SESSION_COOKIE }),
  };
  registerRestApi(server, shipDoor);
  registerMcpEndpoint(server, shipDoor);

  return server;
}
