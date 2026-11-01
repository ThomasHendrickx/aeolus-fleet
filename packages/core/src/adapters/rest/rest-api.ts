/**
 * `/api/v1`: the ship contract as REST, for ships that are not TypeScript or
 * not MCP-capable (ADR 0004). One route per ship procedure and fleet action, each a call
 * through the router (see trpc/ship-contract.ts), and the OpenAPI spec
 * generated from the same procedures at `/api/v1/openapi.json`, rendered for
 * people at `/api/v1/docs`.
 *
 * A ship says who it is with the crew token as `Authorization: Bearer`
 * (ADR 0015); `register` takes the ship secret in its body instead. The
 * console session cookie is never read here: REST is a door for ships.
 */
import fastifyApiReference from '@scalar/fastify-api-reference';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { readAccountToken, readBearer, readOnBehalfOf } from '../http/request-credentials.js';
import type { Context, RequestCredentials } from '../trpc/context.js';
import { callShip, openShipStream, refusalBody, SHIP_CALLS, unexpectedFailure, WAKE_STREAM } from '../trpc/ship-contract.js';
import { wakeStreamOutputSchema, type WakeStreamOutput } from '../trpc/ship.js';
import { API_TITLE, openApiDocument } from './openapi.js';

const PREFIX = '/api/v1';

const OPENAPI_PATH = `${PREFIX}/openapi.json`;

const OPENAPI_DOCUMENT = openApiDocument(SHIP_CALLS, [WAKE_STREAM]);

/** The route of the wake stream, which the request duration histogram leaves out: a stream lasts as long as its crew keeps it. */
export const WAKE_STREAM_ROUTE = `${PREFIX}${WAKE_STREAM.route}`;

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

  server.get(WAKE_STREAM_ROUTE, async (request, reply) => {
    const closing = new AbortController();
    request.raw.on('close', () => {
      closing.abort();
    });
    const opened = await openShipStream(WAKE_STREAM, {
      ctx: options.contextFor(request, { bearer: readBearer(request.headers.authorization), onBehalfOf: readOnBehalfOf(request.headers), accountToken: readAccountToken(request.headers) }),
      closing: closing.signal,
      log: request.log,
    });
    if (!opened.isOk) {
      return reply.code(opened.refusal.httpStatus).send(refusalBody(opened.refusal));
    }
    // The stream is written straight to the socket from here on; Fastify sends nothing more.
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      // A proxy that buffers would hold each wake back.
      'x-accel-buffering': 'no',
      // The connection ends with the stream, so a stopping server has no idle connection left to wait on.
      connection: 'close',
    });
    try {
      let item: unknown = opened.first;
      while (item !== undefined && !closing.signal.aborted) {
        reply.raw.write(serverSentEventOf(wakeStreamOutputSchema.parse(item)));
        const next = await opened.rest.next();
        item = next.done === true ? undefined : next.value;
      }
    } catch (thrown) {
      // The stream is open, so the crew learns only that it closed; the log holds the failure.
      unexpectedFailure(thrown, { log: request.log, requestId: request.id });
    } finally {
      // Ends the stream if the crew closed it between two items, so it stops watching.
      await opened.rest.return?.();
      reply.raw.end();
    }
    return reply;
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
}

/** One item of the wake stream as a server-sent event: a wake or the end as an event with JSON data, a keep-alive as a comment. */
function serverSentEventOf(item: WakeStreamOutput): string {
  switch (item.kind) {
    case 'wake':
      return `event: wake\ndata: ${JSON.stringify({ reason: item.reason })}\n\n`;
    case 'keepAlive':
      return ': keep-alive\n\n';
    case 'end':
      return `event: end\ndata: ${JSON.stringify({ code: item.code, message: item.message })}\n\n`;
  }
}
