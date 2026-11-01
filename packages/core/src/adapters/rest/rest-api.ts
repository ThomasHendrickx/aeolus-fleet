/**
 * `/api/v1`: the ship contract as REST, for ships that are not TypeScript or
 * not MCP-capable (ADR 0004). One route per ship procedure and fleet action, each a call
 * through the router (see trpc/ship-contract.ts), the fleet's events as
 * server-sent events through the same router, and the OpenAPI spec
 * generated from the same procedures at `/api/v1/openapi.json`, rendered for
 * people at `/api/v1/docs`.
 *
 * A ship says who it is with the crew token as `Authorization: Bearer`
 * (ADR 0015); `register` takes the ship secret in its body instead. The
 * console session cookie is never read here: REST is a door for ships.
 */
import { PassThrough, type Readable } from 'node:stream';

import fastifyApiReference from '@scalar/fastify-api-reference';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { readAccountToken, readBearer, readOnBehalfOf } from '../http/request-credentials.js';
import type { Context, RequestCredentials } from '../trpc/context.js';
import { callShip, FLEET_EVENTS_STREAM, openShipStream, refusalBody, SHIP_CALLS, unexpectedFailure, type ShipStreamMessage } from '../trpc/ship-contract.js';
import { API_TITLE, openApiDocument } from './openapi.js';

const PREFIX = '/api/v1';

const OPENAPI_PATH = `${PREFIX}/openapi.json`;

const OPENAPI_DOCUMENT = openApiDocument(SHIP_CALLS, [FLEET_EVENTS_STREAM]);

export interface RestApiOptions {
  /** The context of one call, for this request, with the credentials it carries. */
  contextFor: (request: FastifyRequest, credentials: RequestCredentials) => Context;
}

/**
 * How often a stream sends a comment, so a quiet fleet's stream is not
 * dropped as idle by a proxy or the client's own timeout.
 */
const KEEP_ALIVE_MS = 25_000;

/** One stream message as server-sent event text. */
function serverSentEventOf(message: ShipStreamMessage): string {
  switch (message.kind) {
    case 'item':
      return `id: ${message.id}\ndata: ${JSON.stringify(message.data)}\n\n`;
    case 'end':
      return `event: end\ndata: ${JSON.stringify(refusalBody(message.refusal))}\n\n`;
  }
}

/**
 * A stream's messages as server-sent events: each item with its id, so a
 * client that opens again sends the last as `Last-Event-ID`, and a refusal as
 * `event: end` before the stream closes; a keep-alive comment between them.
 */
function serverSentEventsOf(messages: AsyncIterable<ShipStreamMessage>): Readable {
  const events = new PassThrough();
  const keepAlive = setInterval(() => {
    events.write(': keep-alive\n\n');
  }, KEEP_ALIVE_MS);
  void (async () => {
    for await (const message of messages) {
      events.write(serverSentEventOf(message));
    }
  })()
    .catch((thrown: unknown) => {
      events.destroy(thrown instanceof Error ? thrown : new Error(String(thrown)));
    })
    .finally(() => {
      clearInterval(keepAlive);
      events.end();
    });
  return events;
}

/** Mounts `/api/v1` on the HTTP server: a query without input as GET, the others as POST with a JSON body, and the fleet's events as GET. */
export function registerRestApi(server: FastifyInstance, options: RestApiOptions): void {
  server.get(OPENAPI_PATH, () => OPENAPI_DOCUMENT);

  // The viewer reads the spec above, and the server serves its script itself.
  // The page talks only to the fleet: Scalar's fonts would come from its CDN,
  // and its agent and developer tools call Scalar's services. With no request
  // proxy set, "Try it" calls the fleet directly.
  void server.register(fastifyApiReference, {
    routePrefix: `${PREFIX}/docs`,
    configuration: {
      url: OPENAPI_PATH,
      pageTitle: API_TITLE,
      withDefaultFonts: false,
      agent: { disabled: true },
      showDeveloperTools: 'never',
      telemetry: false,
    },
  });

  for (const call of SHIP_CALLS) {
    server.route({
      method: call.method,
      url: `${PREFIX}${call.route}`,
      handler: async (request, reply) => {
        try {
          const result = await callShip(call, {
            ctx: options.contextFor(request, { bearer: readBearer(request.headers.authorization), onBehalfOf: readOnBehalfOf(request.headers), accountToken: readAccountToken(request.headers) }),
            input: request.body,
            log: request.log,
          });
          if (result.isOk) {
            return result.output;
          }
          return await reply.code(result.refusal.httpStatus).send(refusalBody(result.refusal));
        } catch (thrown) {
          const refusal = unexpectedFailure(thrown, { log: request.log, requestId: request.id });
          return await reply.code(refusal.httpStatus).send(refusalBody(refusal));
        }
      },
    });
  }

  server.get(`${PREFIX}${FLEET_EVENTS_STREAM.route}`, async (request, reply) => {
    // A client that hangs up ends the subscription, which frees its watch.
    const hungUp = new AbortController();
    reply.raw.on('close', () => {
      hungUp.abort();
    });
    try {
      const lastEventId = request.headers['last-event-id'];
      const opened = await openShipStream(FLEET_EVENTS_STREAM, {
        ctx: options.contextFor(request, { bearer: readBearer(request.headers.authorization), onBehalfOf: readOnBehalfOf(request.headers), accountToken: readAccountToken(request.headers) }),
        input: { lastEventId: typeof lastEventId === 'string' ? lastEventId : undefined },
        log: request.log,
        signal: hungUp.signal,
      });
      if (!opened.isOk) {
        return await reply.code(opened.refusal.httpStatus).send(refusalBody(opened.refusal));
      }
      return await reply
        .header('content-type', 'text/event-stream')
        .header('cache-control', 'no-cache')
        .send(serverSentEventsOf(opened.messages));
    } catch (thrown) {
      const refusal = unexpectedFailure(thrown, { log: request.log, requestId: request.id });
      return await reply.code(refusal.httpStatus).send(refusalBody(refusal));
    }
  });
}
