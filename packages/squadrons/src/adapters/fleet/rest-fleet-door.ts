/**
 * The fleet's ship calls over its REST API (`/api/v1`), as any ship that is
 * not TypeScript-bound may make them: squadrons uses the public API like any
 * client (decision 0017). A refusal reads as the fleet's code and message.
 */
import { idSchema, receivedDeliverySchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { FleetDoor, FleetRefusal } from '../../core/management/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';

const refusalSchema = z.object({ code: z.string(), message: z.string() });

/** Where squadrons says its management ship runs: on a server the operator runs. */
const LOCATION = { kind: 'SERVER' } as const;

async function call<T>(
  fleetUrl: string,
  request: { path: string; method: 'GET' | 'POST'; crewToken?: string; body?: unknown; answers: z.ZodType<T>; signal?: AbortSignal },
): Promise<Result<T, FleetRefusal>> {
  const headers: Record<string, string> = {};
  if (request.crewToken !== undefined) {
    headers.authorization = `Bearer ${request.crewToken}`;
  }
  if (request.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  let response: Response;
  let body: unknown;
  try {
    response = await fetch(`${fleetUrl}/api/v1${request.path}`, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: request.signal,
    });
    body = await response.json();
  } catch (error) {
    // Stopping is the caller's own doing; anything else means no answer came.
    if (request.signal?.aborted === true) {
      throw error;
    }
    return err({ code: 'UNAVAILABLE', message: `The fleet did not answer: ${error instanceof Error ? error.message : String(error)}` });
  }
  return response.ok ? ok(request.answers.parse(body)) : err(refusalSchema.parse(body));
}

export function createRestFleetDoor(fleetUrl: string): FleetDoor {
  return {
    register: ({ shipId, secret }) =>
      call(fleetUrl, {
        path: '/ship/register',
        method: 'POST',
        body: { shipId, secret, location: LOCATION },
        answers: z.object({ crewToken: z.string() }),
      }),
    whoami: (crewToken) =>
      call(fleetUrl, {
        path: '/ship/whoami',
        method: 'GET',
        crewToken,
        answers: z.object({ shipId: idSchema('ship'), fleetId: idSchema('fleet'), name: z.string(), type: z.string() }),
      }),
    commission: (crewToken, ship) =>
      call(fleetUrl, {
        path: '/fleet/commission',
        method: 'POST',
        crewToken,
        body: ship,
        answers: z.object({ shipId: idSchema('ship'), crewLine: z.string().nullable() }),
      }),
    getStartingPrompt: (crewToken, ship) =>
      call(fleetUrl, {
        path: '/fleet/getStartingPrompt',
        method: 'POST',
        crewToken,
        body: ship,
        answers: z.object({ crewLine: z.string() }),
      }),
    receive: async (crewToken, until) => {
      const received = await call(fleetUrl, {
        path: '/ship/receive',
        method: 'POST',
        crewToken,
        body: { max: 10 },
        answers: z.object({ deliveries: z.array(receivedDeliverySchema) }),
        signal: until?.signal,
      });
      return received.isOk
        ? ok(received.value.deliveries.map(({ deliveryId, messageId, senderShipId, senderName, contentType, payload, inReplyTo }) => ({ deliveryId, messageId, senderShipId, senderName, contentType, payload, inReplyTo })))
        : received;
    },
    ack: async (crewToken, deliveryId) => {
      const acked = await call(fleetUrl, { path: '/ship/ack', method: 'POST', crewToken, body: { deliveryId }, answers: z.unknown() });
      return acked.isOk ? ok(undefined) : acked;
    },
    send: (crewToken, message) =>
      call(fleetUrl, { path: '/ship/send', method: 'POST', crewToken, body: message, answers: z.object({ messageId: idSchema('message') }) }),
    listShips: async (crewToken) => {
      const listed = await call(fleetUrl, {
        path: '/fleet/list',
        method: 'GET',
        crewToken,
        answers: z.array(z.object({ id: idSchema('ship'), name: z.string(), status: z.string() })),
      });
      return listed.isOk ? ok(listed.value.filter((ship) => ship.status !== 'retired').map(({ id, name }) => ({ shipId: id, name }))) : listed;
    },
    retire: async (crewToken, ship) => {
      const retired = await call(fleetUrl, { path: '/fleet/retire', method: 'POST', crewToken, body: ship, answers: z.unknown() });
      return retired.isOk ? ok(undefined) : retired;
    },
  };
}
