import { commissionShipOutputSchema, fleetListOutputSchema, startingPromptOutputSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { ConnectSquadronsError, type ConnectCalls, type SquadronsConnection } from './connect-squadrons';

/**
 * The calls connecting squadrons makes from the web app's server, each with
 * the operator's console session: the fleet's tRPC procedures at the server's
 * URL, with the console's Origin (the fleet takes a session's state-changing
 * calls only from it), and squadrons' at its URL.
 */

const TIMEOUT_MS = 10_000;

/** Squadrons' connection.status, with its `enabled` named as the console names a boolean. */
const connectionSchema: z.ZodType<SquadronsConnection> = z
  .object({
    enabled: z.boolean(),
    state: z.enum(['not-connected', 'connected']),
    ship: z.object({ shipId: z.string(), name: z.string() }).nullable(),
    lastShipId: z.string().nullable(),
  })
  .transform(({ enabled, ...connection }) => ({ isEnabled: enabled, ...connection }));

const answerSchema = z.union([
  z.object({ result: z.object({ data: z.unknown() }) }),
  z.object({ error: z.object({ message: z.string() }) }),
]);

async function trpc<T>(call: { url: string; procedure: string; input?: unknown; cookie: string; origin?: string; answers: z.ZodType<T> }): Promise<T> {
  const isQuery = call.input === undefined;
  const headers: Record<string, string> = { cookie: call.cookie };
  if (call.origin !== undefined) {
    headers.origin = call.origin;
  }
  if (!isQuery) {
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(`${call.url}/trpc/${call.procedure}`, {
    method: isQuery ? 'GET' : 'POST',
    headers,
    body: isQuery ? undefined : JSON.stringify(call.input),
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const answer = answerSchema.parse(await response.json());
  if ('error' in answer) {
    throw new ConnectSquadronsError(answer.error.message);
  }
  return call.answers.parse(answer.result.data);
}

/** What connecting calls, from the request's cookie and Origin. */
export function squadronsCalls(urls: { serverUrl: string; squadronsUrl: string }, session: { cookie: string; origin: string }): ConnectCalls {
  const fleet = { url: urls.serverUrl, cookie: session.cookie, origin: session.origin };
  const squadrons = { url: urls.squadronsUrl, cookie: session.cookie };
  return {
    status: () => trpc({ ...squadrons, procedure: 'connection.status', answers: connectionSchema }),
    connect: (handOver) => trpc({ ...squadrons, procedure: 'connection.connect', input: handOver, answers: connectionSchema }),
    ships: () => trpc({ ...fleet, procedure: 'fleet.list', answers: fleetListOutputSchema }),
    commission: (ship) => trpc({ ...fleet, procedure: 'fleet.commission', input: ship, answers: commissionShipOutputSchema }),
    release: async (shipId) => {
      await trpc({ ...fleet, procedure: 'fleet.release', input: { shipId }, answers: z.unknown() });
    },
    startingPrompt: (shipId) => trpc({ ...fleet, procedure: 'fleet.getStartingPrompt', input: { shipId }, answers: startingPromptOutputSchema }),
  };
}

/** Squadrons' connection as the operator's session reads it. */
export function readSquadronsConnection(squadronsUrl: string, cookie: string): Promise<SquadronsConnection> {
  return trpc({ url: squadronsUrl, cookie, procedure: 'connection.status', answers: connectionSchema });
}
