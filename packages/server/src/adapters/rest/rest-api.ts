/**
 * `/api/v1`: the ship contract as REST, for ships that are not TypeScript or
 * not MCP-capable (ADR 0004). One route per ship procedure, each a call
 * through the router (see trpc/ship-contract.ts), and the OpenAPI spec
 * generated from the same procedures at `/api/v1/openapi.json`.
 *
 * A ship says who it is with the crew token as `Authorization: Bearer`
 * (ADR 0015); `register` takes the ship secret in its body instead. The
 * console session cookie is never read here: REST is a door for ships.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { readBearer } from '../http/request-credentials.js';
import type { Context, RequestCredentials } from '../trpc/context.js';
import { callShip, SHIP_CALLS } from '../trpc/ship-contract.js';
import { openApiDocument } from './openapi.js';

const PREFIX = '/api/v1';

const OPENAPI_DOCUMENT = openApiDocument(SHIP_CALLS);

export interface RestApiOptions {
  /** The context of one call, for this request, with the credentials it carries. */
  contextFor: (request: FastifyRequest, credentials: RequestCredentials) => Context;
}

/** Mounts `/api/v1` on the HTTP server: a query as GET, without input; a mutation as POST, with its JSON body. */
export function registerRestApi(server: FastifyInstance, options: RestApiOptions): void {
  server.get(`${PREFIX}/openapi.json`, () => OPENAPI_DOCUMENT);

  for (const call of SHIP_CALLS) {
    server.route({
      method: call.type === 'query' ? 'GET' : 'POST',
      url: `${PREFIX}/ship/${call.name}`,
      handler: async (request, reply) => {
        const result = await callShip(call, {
          ctx: options.contextFor(request, { bearer: readBearer(request.headers.authorization) }),
          input: request.body,
          log: request.log,
        });
        if (result.isOk) {
          return result.output;
        }
        const { httpStatus, code, message, requestId } = result.refusal;
        return reply.code(httpStatus).send(requestId === undefined ? { code, message } : { code, message, requestId });
      },
    });
  }
}
