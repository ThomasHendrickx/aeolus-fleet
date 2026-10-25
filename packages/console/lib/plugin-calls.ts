import { commissionShipOutputSchema, fleetListOutputSchema, grantScopesOutputSchema, PAGE_SIZE_MAX, shipOutputSchema, startingPromptOutputSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { ConnectPluginError, type ConnectCalls, type PluginConnection } from './connect-plugin';
import { everyPage } from './every-page';
import { dataOf } from './plugin-answer';
import { EVERY_SHIP_STATUS } from './every-ship-status';

/**
 * The calls connecting a plugin makes from the web app's server, each with
 * the operator's console session: the fleet's tRPC procedures at the server's
 * URL, with the console's Origin (the fleet takes a session's state-changing
 * calls only from it), and the plugin's at its URL. Squadrons and the
 * trierarch plugin answer connection.status and connection.connect alike.
 */

const TIMEOUT_MS = 10_000;

/** A plugin's connection.status, with its `enabled` named as the console names a boolean. */
const connectionSchema: z.ZodType<PluginConnection> = z
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

async function trpc<T>(call: { url: string; procedure: string; input?: unknown; isQuery?: boolean; cookie: string; origin?: string; answers: z.ZodType<T> }): Promise<T> {
  // A call without input is a query; one with input is a change unless it says it is a query, whose input goes in the URL.
  const isQuery = call.input === undefined || call.isQuery === true;
  const search = isQuery && call.input !== undefined ? `?input=${encodeURIComponent(JSON.stringify(call.input))}` : '';
  const headers: Record<string, string> = { cookie: call.cookie };
  if (call.origin !== undefined) {
    headers.origin = call.origin;
  }
  if (!isQuery) {
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(`${call.url}/trpc/${call.procedure}${search}`, {
    method: isQuery ? 'GET' : 'POST',
    headers,
    body: isQuery ? undefined : JSON.stringify(call.input),
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const answer = answerSchema.parse(await response.json());
  if ('error' in answer) {
    throw new ConnectPluginError(answer.error.message);
  }
  return call.answers.parse(answer.result.data);
}

/** What connecting calls, from the request's cookie and Origin. */
export function pluginCalls(urls: { serverUrl: string; pluginUrl: string }, session: { cookie: string; origin: string }): ConnectCalls {
  const fleet = { url: urls.serverUrl, cookie: session.cookie, origin: session.origin };
  const plugin = { url: urls.pluginUrl, cookie: session.cookie };
  return {
    status: () => trpc({ ...plugin, procedure: 'connection.status', answers: connectionSchema }),
    connect: (handOver) => trpc({ ...plugin, procedure: 'connection.connect', input: handOver, answers: connectionSchema }),
    shipScopes: (shipId) => readShipScopes(fleet, shipId),
    ships: async () =>
      dataOf(
        await everyPage(async (cursor) => ({
          kind: 'answered',
          data: await trpc({ ...fleet, procedure: 'fleet.list', input: { cursor, limit: PAGE_SIZE_MAX, status: EVERY_SHIP_STATUS }, isQuery: true, answers: fleetListOutputSchema }),
        })),
      ),
    grantScopes: (shipId, grant) => trpc({ ...fleet, procedure: 'fleet.grantScopes', input: { shipId, grant, revoke: [] }, answers: grantScopesOutputSchema }),
    commission: (ship) => trpc({ ...fleet, procedure: 'fleet.commission', input: ship, answers: commissionShipOutputSchema }),
    release: async (shipId) => {
      await trpc({ ...fleet, procedure: 'fleet.release', input: { shipId }, answers: z.unknown() });
    },
    startingPrompt: (shipId) => trpc({ ...fleet, procedure: 'fleet.getStartingPrompt', input: { shipId }, answers: startingPromptOutputSchema }),
  };
}

/** A ship's scopes as the operator's session reads them (fleet.ship); undefined when the fleet shows it without them. */
async function readShipScopes(fleet: { url: string; cookie: string }, shipId: string): Promise<readonly string[] | undefined> {
  const ship = await trpc({ ...fleet, procedure: 'fleet.ship', input: { shipId }, isQuery: true, answers: shipOutputSchema });
  return 'scopes' in ship ? ship.scopes : undefined;
}

/** Squadrons' connection as the operator's session reads it. */
export function readPluginConnection(squadronsUrl: string, cookie: string): Promise<PluginConnection> {
  return trpc({ url: squadronsUrl, cookie, procedure: 'connection.status', answers: connectionSchema });
}
