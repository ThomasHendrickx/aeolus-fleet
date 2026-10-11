/**
 * The fleet's ship calls over its REST API (`/api/v1`), as any ship that is
 * not TypeScript-bound may make them: the networking plugin uses the public API
 * like any client (decision 0035). A refusal reads as the fleet's code and
 * message. While the fleet is busy (nothing stored), each call is made again
 * by itself with the same body, after each of the busy waits (each drawn by
 * `busyWaitMs`); a stopped call ends at once, also while it waits.
 */
import { setTimeout as wait } from 'node:timers/promises';

import { busyWaitMs, declaredNetworkRulesOutputSchema, FLEET_BUSY_WAITS_MS, followFleetOutputSchema, idSchema, receivedDeliverySchema, shipDetailOutputSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { FleetDoor, FleetRefusal } from '../../core/connection/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';

const refusalSchema = z.object({ code: z.string(), message: z.string() });

/** The fleet's code for a call it could not start: nothing was stored, so the same call may be made again. */
const FLEET_BUSY = 'SERVICE_UNAVAILABLE';

/** Where the networking plugin says its ship runs: on a server the operator runs. */
const LOCATION = { kind: 'SERVER' } as const;

/** The harness the networking plugin states when it registers its ship: it is software, not a model. */
const HARNESS = 'aeolus-networking-plugin';

/** The most deliveries one receive takes. */
const RECEIVE_MAX = 10;

/** One call to the fleet. */
interface FleetCall<T> {
  path: string;
  method: 'GET' | 'POST';
  crewToken?: string;
  body?: unknown;
  answers: z.ZodType<T>;
  signal?: AbortSignal;
}

/** Where the fleet answers, how long to wait before each next call while it is busy, the draw for each wait, and how a drawn wait is waited. */
interface Door {
  fleetUrl: string;
  busyWaitsMs: readonly number[];
  random: () => number;
  wait: (waitMs: number, signal?: AbortSignal) => Promise<void>;
}

async function callFleet<T>({ fleetUrl, busyWaitsMs, random, wait: waitBusy }: Door, request: FleetCall<T>): Promise<Result<T, FleetRefusal>> {
  for (const waitMs of busyWaitsMs) {
    const answered = await callOnce(fleetUrl, request);
    if (answered.isOk || answered.error.code !== FLEET_BUSY) {
      return answered;
    }
    await waitBusy(busyWaitMs(waitMs, random), request.signal);
  }
  return callOnce(fleetUrl, request);
}

async function callOnce<T>(fleetUrl: string, request: FleetCall<T>): Promise<Result<T, FleetRefusal>> {
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

export function createRestFleetDoor(fleetUrl: string, options: { busyWaitsMs?: readonly number[]; random?: () => number; wait?: (waitMs: number, signal?: AbortSignal) => Promise<void> } = {}): FleetDoor {
  const door = { fleetUrl, busyWaitsMs: options.busyWaitsMs ?? FLEET_BUSY_WAITS_MS, random: options.random ?? Math.random, wait: options.wait ?? ((waitMs: number, signal?: AbortSignal) => wait(waitMs, undefined, { signal })) };
  const call = <T>(request: FleetCall<T>) => callFleet(door, request);
  return {
    register: ({ shipId, secret }) =>
      call({ path: '/ship/register', method: 'POST', body: { shipId, secret, location: LOCATION, harness: HARNESS }, answers: z.object({ crewToken: z.string() }) }),
    whoami: (crewToken) =>
      call({
        path: '/ship/whoami',
        method: 'GET',
        crewToken,
        answers: z.object({ shipId: idSchema('ship'), fleetId: idSchema('fleet'), name: z.string(), type: z.string() }),
      }),
    getShip: async (crewToken, ship) => {
      const read = await call({ path: '/fleet/ship', method: 'POST', crewToken, body: ship, answers: shipDetailOutputSchema });
      if (!read.isOk) {
        return read;
      }
      const { status, scopes } = read.value;
      return ok({ status, scopes });
    },
    deregister: async (crewToken) => {
      const ended = await call({ path: '/ship/deregister', method: 'POST', crewToken, body: {}, answers: z.unknown() });
      return ended.isOk ? ok(undefined) : ended;
    },
    registerNetworkPlugin: async (crewToken, declaration) => {
      const registered = await call({ path: '/fleet/registerNetworkPlugin', method: 'POST', crewToken, body: declaration, answers: z.unknown() });
      return registered.isOk ? ok(undefined) : registered;
    },
    unregisterNetworkPlugin: async (crewToken) => {
      const unregistered = await call({ path: '/fleet/unregisterNetworkPlugin', method: 'POST', crewToken, body: {}, answers: z.unknown() });
      return unregistered.isOk ? ok(undefined) : unregistered;
    },
    setNetworkRules: async (crewToken, rules) => {
      const set = await call({ path: '/fleet/setNetworkRules', method: 'POST', crewToken, body: { rules }, answers: z.unknown() });
      return set.isOk ? ok(undefined) : set;
    },
    declaredNetworkRules: (crewToken) => call({ path: '/fleet/declaredNetworkRules', method: 'GET', crewToken, answers: declaredNetworkRulesOutputSchema }),
    follow: async (crewToken, { afterSeq, waitSeconds, signal }) => {
      const followed = await call({ path: '/fleet/follow', method: 'POST', crewToken, body: { afterSeq, waitSeconds }, answers: followFleetOutputSchema, signal });
      return followed.isOk ? ok({ types: followed.value.events.map((event) => event.type), lastSeq: followed.value.lastSeq }) : followed;
    },
    receive: async (crewToken, until) => {
      const received = await call({
        path: '/ship/receive',
        method: 'POST',
        crewToken,
        body: { max: RECEIVE_MAX },
        answers: z.object({ deliveries: z.array(receivedDeliverySchema) }),
        signal: until?.signal,
      });
      return received.isOk ? ok(received.value.deliveries.map(({ deliveryId, contentType }) => ({ deliveryId, contentType }))) : received;
    },
    ack: async (crewToken, deliveryId) => {
      const acked = await call({ path: '/ship/ack', method: 'POST', crewToken, body: { deliveryId }, answers: z.unknown() });
      return acked.isOk ? ok(undefined) : acked;
    },
    pong: async (crewToken, deliveryId) => {
      const ponged = await call({ path: '/ship/pong', method: 'POST', crewToken, body: { deliveryId }, answers: z.unknown() });
      return ponged.isOk ? ok(undefined) : ponged;
    },
  };
}
