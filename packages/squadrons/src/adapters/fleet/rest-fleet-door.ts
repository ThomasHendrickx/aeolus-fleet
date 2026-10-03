/**
 * The fleet's ship calls over its REST API (`/api/v1`), as any ship that is
 * not TypeScript-bound may make them: squadrons uses the public API like any
 * client (decision 0017). A refusal reads as the fleet's code and message.
 */
import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { FleetDoor, FleetRefusal } from '../../core/management/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';

const refusalSchema = z.object({ code: z.string(), message: z.string() });

/** Where squadrons says its management ship runs: on a server the operator runs. */
const LOCATION = { kind: 'SERVER' } as const;

async function call<T>(
  fleetUrl: string,
  request: { path: string; method: 'GET' | 'POST'; crewToken?: string; body?: unknown; answers: z.ZodType<T> },
): Promise<Result<T, FleetRefusal>> {
  const headers: Record<string, string> = {};
  if (request.crewToken !== undefined) {
    headers.authorization = `Bearer ${request.crewToken}`;
  }
  if (request.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(`${fleetUrl}/api/v1${request.path}`, {
    method: request.method,
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });
  const body: unknown = await response.json();
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
        answers: z.object({ shipId: idSchema('ship'), crewLine: z.string() }),
      }),
    retire: async (crewToken, ship) => {
      const retired = await call(fleetUrl, { path: '/fleet/retire', method: 'POST', crewToken, body: ship, answers: z.unknown() });
      return retired.isOk ? ok(undefined) : retired;
    },
  };
}
