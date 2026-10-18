import { cookies } from 'next/headers';

import { ConnectPluginError } from './connect-plugin';
import { gatewayUrlFrom } from './gateway-url';
import type { PluginAnswer } from './plugin-answer';
import { sessionCookieOf } from './plugin-call';
import { readPluginConnection } from './plugin-calls';
import { shownConnectionOf, type ShownConnection } from './shown-connection';

/**
 * The gateway as the browser reads it (decision 0033): a console read
 * (lib/console-reads.ts) on the web app's server, calling the gateway with
 * the operator's console session and parsing its answer, so the browser gets
 * only the connection it renders. Without the gateway, or while it is off for
 * this fleet, the browser learns only `none`. Connecting it is a server
 * function (lib/gateway-actions.ts), which shares these calls.
 */

export const NOT_HERE: PluginAnswer<never> = { kind: 'refused', message: 'This console has no gateway' };

export async function sessionCookie(): Promise<string> {
  return sessionCookieOf((await cookies()).toString());
}

/** A refusal's words are safe to show; anything else says only that the gateway or the fleet did not answer. */
export function refusalOf(error: unknown): PluginAnswer<never> {
  return { kind: 'refused', message: error instanceof ConnectPluginError ? error.message : 'the gateway or the fleet did not answer: try again in a moment' };
}

/** The gateway's connection as the browser may know it: `none` without the gateway or while it is off. */
export async function readGatewayConnection(): Promise<PluginAnswer<ShownConnection>> {
  const url = gatewayUrlFrom(process.env);
  if (url === undefined) {
    return { kind: 'answered', data: shownConnectionOf(undefined) };
  }
  try {
    return { kind: 'answered', data: shownConnectionOf(await readPluginConnection(url, await sessionCookie())) };
  } catch (error) {
    return refusalOf(error);
  }
}
