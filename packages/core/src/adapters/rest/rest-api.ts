/**
 * `/api/v1`: the ship contract as REST, for ships that are not TypeScript or
 * not MCP-capable (ADR 0004). One route per ship procedure and fleet action, each a call
 * through the router (see trpc/ship-contract.ts), its streams as
 * server-sent events through the same router, and the OpenAPI spec
 * generated from the same procedures at `/api/v1/openapi.json`, rendered for
 * people at `/api/v1/docs`.
 *
 * A ship says who it is with the crew token as `Authorization: Bearer`
 * (ADR 0015); `register` takes the ship secret in its body instead. The
 * console session cookie is never read here: REST is a door for ships.
 */
import { fleetStreamItemSchema } from '@aeolus-fleet/common';
import fastifyApiReference from '@scalar/fastify-api-reference';
import { isTrackedEnvelope } from '@trpc/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { readAccountToken, readBearer, readOnBehalfOf } from '../http/request-credentials.js';
import type { Context, RequestCredentials } from '../trpc/context.js';
import {
  callShip,
  FLEET_EVENTS_STREAM,
  openShipStream,
  refusalBody,
  SHIP_CALLS,
  streamRefusal,
  unexpectedFailure,
  WAKE_STREAM,
  type ShipStream,
} from '../trpc/ship-contract.js';
import { wakeStreamOutputSchema, type WakeStreamOutput } from '../trpc/ship.js';
import { API_TITLE, openApiDocument } from './openapi.js';

const PREFIX = '/api/v1';

const OPENAPI_PATH = `${PREFIX}/openapi.json`;

const OPENAPI_DOCUMENT = openApiDocument(SHIP_CALLS, [WAKE_STREAM, FLEET_EVENTS_STREAM]);

/** The route of the wake stream, which the request duration histogram leaves out: a stream lasts as long as its crew keeps it. */
export const WAKE_STREAM_ROUTE = `${PREFIX}${WAKE_STREAM.route}`;

/** The route of the fleet events stream, which the request duration histogram leaves out too: it lasts as long as its follower keeps it. */
export const FLEET_EVENTS_STREAM_ROUTE = `${PREFIX}${FLEET_EVENTS_STREAM.route}`;

/**
 * How often the fleet events stream sends a comment, as the wake stream's
 * keep-alive does, so a quiet fleet's stream is not dropped as idle by a
 * proxy or the client's own timeout.
 */
const FLEET_EVENTS_KEEP_ALIVE_MS = 25_000;

export interface RestApiOptions {
  /** The context of one call, for this request, with the credentials it carries. */
  contextFor: (request: FastifyRequest, credentials: RequestCredentials) => Context;
}

/** Mounts `/api/v1` on the HTTP server: a query without input as GET, the others as POST with a JSON body. */
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

  server.get(WAKE_STREAM_ROUTE, async (request, reply) =>
    serveStream({ request, reply }, {
      stream: WAKE_STREAM,
      eventOf: (item) => wakeEventOf(wakeStreamOutputSchema.parse(item)),
      // The stream says its own end, so the crew learns only that it closed; the log holds the failure.
      endOf: (thrown) => {
        unexpectedFailure(thrown, { log: request.log, requestId: request.id });
        return '';
      },
    }),
  );

  server.get(FLEET_EVENTS_STREAM_ROUTE, async (request, reply) =>
    serveStream({ request, reply }, {
      stream: FLEET_EVENTS_STREAM,
      eventOf: fleetEventOf,
      // The subscription ends with the refusal once its caller no longer holds: said as event end.
      endOf: (thrown) => {
        const refusal = streamRefusal(thrown, { stream: FLEET_EVENTS_STREAM, log: request.log, requestId: request.id });
        return `event: end\ndata: ${JSON.stringify(refusalBody(refusal))}\n\n`;
      },
      keepAliveMs: FLEET_EVENTS_KEEP_ALIVE_MS,
    }),
  );

  /**
   * Opens a stream as the request's caller and writes it as server-sent
   * events: a refusal on opening answers as a call's; then each item, until
   * the stream ends, fails or the client closes it.
   */
  async function serveStream(
    { request, reply }: { request: FastifyRequest; reply: FastifyReply },
    served: { stream: ShipStream; eventOf: (item: unknown) => string; endOf: (thrown: unknown) => string; keepAliveMs?: number },
  ): Promise<FastifyReply> {
    const { stream, eventOf, endOf, keepAliveMs } = served;
    const closing = new AbortController();
    request.raw.on('close', () => {
      closing.abort();
    });
    const position = stream.position && request.headers[stream.position.header.toLowerCase()];
    const opened = await openShipStream(stream, {
      ctx: options.contextFor(request, { bearer: readBearer(request.headers.authorization), onBehalfOf: readOnBehalfOf(request.headers), accountToken: readAccountToken(request.headers) }),
      closing: closing.signal,
      log: request.log,
      position: typeof position === 'string' ? position : undefined,
    });
    if (!opened.isOk) {
      return reply.code(opened.refusal.httpStatus).send(refusalBody(opened.refusal));
    }
    // The stream is written straight to the socket from here on; Fastify sends nothing more.
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      // A proxy that buffers would hold each item back.
      'x-accel-buffering': 'no',
      // The connection ends with the stream, so a stopping server has no idle connection left to wait on.
      connection: 'close',
    });
    const keepAlive = keepAliveMs === undefined ? undefined : setInterval(() => {
      reply.raw.write(KEEP_ALIVE_COMMENT);
    }, keepAliveMs);
    try {
      for (let next = await opened.items.next(); next.done !== true && !closing.signal.aborted; next = await opened.items.next()) {
        reply.raw.write(eventOf(next.value));
      }
    } catch (thrown) {
      reply.raw.write(endOf(thrown));
    } finally {
      clearInterval(keepAlive);
      // Ends the stream if the client closed it between two items, so it stops watching.
      await opened.items.return?.();
      reply.raw.end();
    }
    return reply;
  }

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
}

/** A keep-alive as a server-sent comment, which a client reads past. */
const KEEP_ALIVE_COMMENT = ': keep-alive\n\n';

/** One item of the wake stream as a server-sent event: a wake or the end as an event with JSON data, a keep-alive as a comment. */
function wakeEventOf(item: WakeStreamOutput): string {
  switch (item.kind) {
    case 'wake':
      return `event: wake\ndata: ${JSON.stringify({ reason: item.reason })}\n\n`;
    case 'keepAlive':
      return KEEP_ALIVE_COMMENT;
    case 'end':
      return `event: end\ndata: ${JSON.stringify({ code: item.code, message: item.message })}\n\n`;
  }
}

/** One fleet event, or the word to load the fleet again, as a server-sent event: its number as the id, the item as JSON data. */
function fleetEventOf(item: unknown): string {
  if (!isTrackedEnvelope(item)) {
    throw new TypeError('fleet.events tracks each item by its event number');
  }
  const [id, data] = item;
  return `id: ${id}\ndata: ${JSON.stringify(fleetStreamItemSchema.parse(data))}\n\n`;
}
