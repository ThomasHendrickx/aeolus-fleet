/**
 * The OpenAPI 3.1 document of the ship contract under `/api/v1`, generated
 * from the router (see trpc/ship-contract.ts): one operation per ship
 * procedure, described with the rules the procedure states, with the JSON
 * Schema of what it takes and answers. JSON Schema 2020-12 is OpenAPI 3.1's
 * own dialect, so the schemas go in as the router's parsers produce them.
 */
import type { ShipCall, ShipStream } from '../trpc/ship-contract.js';
import { SHIP_PROTOCOL } from '../trpc/ship-protocol.js';

/** The API's title, in the spec and on its page at `/api/v1/docs`. */
export const API_TITLE = 'Aeolus ship API';

const JSON_MEDIA_TYPE = 'application/json';

const ERROR_SCHEMA = {
  type: 'object',
  properties: {
    code: {
      type: 'string',
      description: "The refusal's code, such as UNAUTHORIZED, LEASE_ENDED, FORBIDDEN, NOT_FOUND or CONFLICT, or a delivery's own code, such as DELIVERY_NOT_IN_FLIGHT, for a refusal about that delivery.",
    },
    message: { type: 'string', description: 'What was refused, or what the input must be, for the caller to read.' },
    requestId: {
      type: 'string',
      description: 'Only for a server failure (INTERNAL_SERVER_ERROR): the id under which the server log holds it.',
    },
  },
  required: ['code', 'message'],
};

/** The ship protocol, as the MCP server instructions state it, then what is REST's own. */
const API_DESCRIPTION = [
  SHIP_PROTOCOL,
  [
    'The ship contract over REST: the same calls an agent reaches as MCP tools at /mcp.',
    'The crew token travels as Authorization: Bearer <crew token>.',
    'A refusal answers with the HTTP status of its code, and its code and message as JSON.',
  ].join(' '),
].join('\n\n');

/** A ship call as an OpenAPI operation. */
function operationOf(call: ShipCall): Record<string, unknown> {
  const json = (schema: unknown) => ({ [JSON_MEDIA_TYPE]: { schema } });
  return {
    operationId: call.name,
    description: call.description,
    security: call.credential === 'crewToken' ? [{ crewToken: [] }] : [],
    ...(call.input && { requestBody: { required: call.input.isRequired, content: json(call.input.schema) } }),
    responses: {
      '200': { description: 'Done.', content: json(call.output) },
      default: { description: 'Refused or failed.', content: json({ $ref: '#/components/schemas/Error' }) },
    },
  };
}

/** A ship stream as an OpenAPI operation: GET, answered with server-sent events, its position in `Last-Event-ID`. */
function streamOperationOf(stream: ShipStream): Record<string, unknown> {
  return {
    operationId: stream.name,
    description: stream.description,
    security: [{ crewToken: [] }],
    parameters: [
      {
        name: 'Last-Event-ID',
        in: 'header',
        required: false,
        description: 'The id of the last event you read, to follow from after it.',
        schema: { type: 'string' },
      },
    ],
    responses: {
      '200': {
        description: 'Server-sent events: each with the id to send back as Last-Event-ID and the item as data; event: end with a refusal last.',
        content: { 'text/event-stream': { schema: stream.item } },
      },
      default: { description: 'Refused or failed.', content: { [JSON_MEDIA_TYPE]: { schema: { $ref: '#/components/schemas/Error' } } } },
    },
  };
}

/** The document for the given ship calls, a query without input as GET and the others as POST with a JSON body, then the streams as GET. */
export function openApiDocument(calls: readonly ShipCall[], streams: readonly ShipStream[]): Record<string, unknown> {
  return {
    openapi: '3.1.1',
    info: { title: API_TITLE, version: '1', description: API_DESCRIPTION },
    servers: [{ url: '/api/v1' }],
    paths: Object.fromEntries([
      ...calls.map((call) => [call.route, { [call.method.toLowerCase()]: operationOf(call) }]),
      ...streams.map((stream) => [stream.route, { get: streamOperationOf(stream) }]),
    ]),
    components: {
      securitySchemes: {
        crewToken: {
          type: 'http',
          scheme: 'bearer',
          description: 'The crew token register answered with (aeolus_ct_v1_...): it says which ship you crew.',
        },
      },
      schemas: { Error: ERROR_SCHEMA },
    },
  };
}
