/**
 * The fleet's ship calls over its REST API (`/api/v1`), as any ship that is
 * not TypeScript-bound may make them: squadrons uses the public API like any
 * client (decision 0017). A refusal reads as the fleet's code and message.
 * While the fleet is busy (nothing stored), each call is made again by itself
 * with the same body, after each of the busy waits (each drawn by
 * `busyWaitMs`), so a send keeps its idempotency key.
 */
import { setTimeout as wait } from 'node:timers/promises';

import { busyWaitMs, crewLineSchema, FLEET_BUSY_WAITS_MS, findLabelValueOutputSchema, idSchema, receivedDeliverySchema, shipDetailOutputSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { FleetDoor, FleetRefusal } from '../../core/management/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';
import { runningVersion } from '../http/version.js';

const refusalSchema = z.object({ code: z.string(), message: z.string() });

/** The fleet's code for a call it could not start: nothing was stored, so the same call may be made again. */
const FLEET_BUSY = 'SERVICE_UNAVAILABLE';

/** Where squadrons says its management ship runs: on a server the operator runs. */
const LOCATION = { kind: 'SERVER' } as const;

/**
 * What squadrons' own ships, its management ship and every flagship, state
 * as model and harness (#157): squadrons is software, not a model, so it
 * names its package and the version it runs, read from its package.json.
 */
export const SQUADRONS_SELF = { model: `@aeolus-fleet/squadrons@${runningVersion()}`, harness: 'aeolus-squadrons' } as const;

/** One call to the fleet. */
interface FleetCall<T> {
  path: string;
  method: 'GET' | 'POST';
  crewToken?: string;
  body?: unknown;
  answers: z.ZodType<T>;
  signal?: AbortSignal;
}

/** Where the fleet answers, how long to wait before each next call while it is busy, and the draw for each wait. */
interface Door {
  fleetUrl: string;
  busyWaitsMs: readonly number[];
  random: () => number;
}

async function call<T>({ fleetUrl, busyWaitsMs, random }: Door, request: FleetCall<T>): Promise<Result<T, FleetRefusal>> {
  for (const waitMs of busyWaitsMs) {
    const answered = await callOnce(fleetUrl, request);
    if (answered.isOk || answered.error.code !== FLEET_BUSY) {
      return answered;
    }
    await wait(busyWaitMs(waitMs, random), undefined, { signal: request.signal });
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

function dateOf(iso: string | null): Date | null {
  return iso === null ? null : new Date(iso);
}

export function createRestFleetDoor(fleetUrl: string, options: { busyWaitsMs?: readonly number[]; random?: () => number } = {}): FleetDoor {
  const door = { fleetUrl, busyWaitsMs: options.busyWaitsMs ?? FLEET_BUSY_WAITS_MS, random: options.random ?? Math.random };
  return {
    register: ({ shipId, secret }) =>
      call(door, {
        path: '/ship/register',
        method: 'POST',
        body: { shipId, secret, location: LOCATION, harness: SQUADRONS_SELF.harness },
        answers: z.object({ crewToken: z.string() }),
      }),
    whoami: (crewToken) =>
      call(door, {
        path: '/ship/whoami',
        method: 'GET',
        crewToken,
        answers: z.object({ shipId: idSchema('ship'), fleetId: idSchema('fleet'), name: z.string(), type: z.string() }),
      }),
    commission: (crewToken, ship) =>
      call(door, {
        path: '/fleet/commission',
        method: 'POST',
        crewToken,
        body: ship,
        answers: z.object({ shipId: idSchema('ship'), secret: z.string().nullable(), crewLines: z.array(crewLineSchema).nullable() }),
      }),
    getShip: async (crewToken, ship) => {
      const read = await call(door, { path: '/fleet/ship', method: 'POST', crewToken, body: ship, answers: shipDetailOutputSchema });
      if (!read.isOk) {
        return read;
      }
      const { status, scopes, lastSeenAt, crewedSince, report, openDeliveries, inFlightDeliveries, crewRequest } = read.value;
      return ok({
        status,
        scopes,
        lastSeenAt: dateOf(lastSeenAt),
        crewedSince: dateOf(crewedSince),
        reportedAt: dateOf(report?.reportedAt ?? null),
        openDeliveries,
        inFlightDeliveries,
        hasCrewRequest: crewRequest !== null,
      });
    },
    deregister: async (crewToken) => {
      const ended = await call(door, { path: '/ship/deregister', method: 'POST', crewToken, body: {}, answers: z.unknown() });
      return ended.isOk ? ok(undefined) : ended;
    },
    getStartingPrompt: (crewToken, ship) =>
      call(door, {
        path: '/fleet/getStartingPrompt',
        method: 'POST',
        crewToken,
        body: ship,
        answers: z.object({ secret: z.string(), crewLines: z.array(crewLineSchema) }),
      }),
    receive: async (crewToken, until) => {
      const received = await call(door, {
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
      const acked = await call(door, { path: '/ship/ack', method: 'POST', crewToken, body: { deliveryId }, answers: z.unknown() });
      return acked.isOk ? ok(undefined) : acked;
    },
    pong: async (crewToken, deliveryId) => {
      const ponged = await call(door, { path: '/ship/pong', method: 'POST', crewToken, body: { deliveryId }, answers: z.unknown() });
      return ponged.isOk ? ok(undefined) : ponged;
    },
    send: (crewToken, message) =>
      call(door, { path: '/ship/send', method: 'POST', crewToken, body: { ...message, model: SQUADRONS_SELF.model }, answers: z.object({ messageId: idSchema('message') }) }),
    listShips: async (crewToken) => {
      const listed = await call(door, {
        path: '/fleet/list',
        method: 'POST',
        crewToken,
        body: {},
        answers: z.array(z.object({ id: idSchema('ship'), name: z.string(), status: z.string() })),
      });
      return listed.isOk ? ok(listed.value.filter((ship) => ship.status !== 'retired').map(({ id, name }) => ({ shipId: id, name }))) : listed;
    },
    requestCrew: async (crewToken, request) => {
      const requested = await call(door, { path: '/fleet/crewRequest', method: 'POST', crewToken, body: request, answers: z.unknown() });
      return requested.isOk ? ok(undefined) : requested;
    },
    removeCrewRequest: async (crewToken, ship) => {
      const removed = await call(door, { path: '/fleet/removeCrewRequest', method: 'POST', crewToken, body: ship, answers: z.unknown() });
      return removed.isOk ? ok(undefined) : removed;
    },
    findLabelValue: async (crewToken, label) => {
      const found = await call(door, { path: '/fleet/findLabelValue', method: 'POST', crewToken, body: label, answers: findLabelValueOutputSchema });
      return found.isOk ? ok({ valueId: found.value.valueId }) : found;
    },
    release: async (crewToken, ship) => {
      const released = await call(door, { path: '/fleet/release', method: 'POST', crewToken, body: ship, answers: z.unknown() });
      return released.isOk ? ok(undefined) : released;
    },
    retire: async (crewToken, ship) => {
      const retired = await call(door, { path: '/fleet/retire', method: 'POST', crewToken, body: ship, answers: z.unknown() });
      return retired.isOk ? ok(undefined) : retired;
    },
  };
}
