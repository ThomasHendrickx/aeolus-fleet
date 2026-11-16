import { cookies } from 'next/headers';

import { ConnectPluginError, NO_MISSING_SCOPES, WATCH_PLUGIN_SHIP } from './connect-plugin';
import { WATCH_PLUGIN_NO_ANSWER } from './no-answer';
import type { PluginAnswer } from './plugin-answer';
import { sessionCookieOf } from './plugin-call';
import { readShownConnection } from './plugin-calls';
import { serverInternalUrlFrom } from './server-url';
import { shownConnectionOf, type ShownConnection } from './shown-connection';
import { watchPluginUrlFrom } from './watch-plugin-url';

/**
 * The watch plugin as the browser reads it (decision 0033): a console read
 * (lib/console-reads.ts) on the web app's server, calling the watch plugin
 * with the operator's console session and parsing its answer, so the browser
 * gets only the connection it renders. Without the watch plugin, or while it
 * is off for this fleet, the browser learns only `none`. Connecting it is a
 * server function (lib/watch-plugin-actions.ts), which shares these calls.
 */

export const NOT_HERE: PluginAnswer<never> = { kind: 'refused', message: 'This console has no watch plugin' };

export async function sessionCookie(): Promise<string> {
  return sessionCookieOf((await cookies()).toString());
}

/** A refusal's words are safe to show; anything else says only that the watch plugin or the fleet did not answer. */
export function refusalOf(error: unknown): PluginAnswer<never> {
  return { kind: 'refused', message: error instanceof ConnectPluginError ? error.message : WATCH_PLUGIN_NO_ANSWER };
}

/** The watch plugin's connection as the browser may know it: `none` without the watch plugin or while it is off. */
export async function readWatchPluginConnection(): Promise<PluginAnswer<ShownConnection>> {
  const url = watchPluginUrlFrom(process.env);
  if (url === undefined) {
    return { kind: 'answered', data: shownConnectionOf(undefined, NO_MISSING_SCOPES) };
  }
  try {
    return { kind: 'answered', data: await readShownConnection({ serverUrl: serverInternalUrlFrom(process.env), pluginUrl: url }, { cookie: await sessionCookie(), wanted: WATCH_PLUGIN_SHIP }) };
  } catch (error) {
    return refusalOf(error);
  }
}
