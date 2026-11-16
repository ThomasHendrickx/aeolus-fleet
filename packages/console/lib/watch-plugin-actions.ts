'use server';

import { headers } from 'next/headers';

import { connectPlugin, WATCH_PLUGIN_SHIP } from './connect-plugin';
import type { PluginAnswer } from './plugin-answer';
import { pluginCalls, shownConnection } from './plugin-calls';
import { serverInternalUrlFrom } from './server-url';
import type { ShownConnection } from './shown-connection';
import { NOT_HERE, refusalOf, sessionCookie } from './watch-plugin-reads';
import { watchPluginUrlFrom } from './watch-plugin-url';

/**
 * Connect the watch plugin, the operator's one button: commissions its ship,
 * watch-plugin with WATCH_PLUGIN_SHIP's scopes, or gives it a new starting
 * prompt, and hands its secret to the watch plugin, server to server, as its
 * read does (lib/watch-plugin-reads.ts). When the watch plugin refuses, its
 * words show. The browser gets the connection only.
 */
export async function connectWatchPlugin(): Promise<PluginAnswer<ShownConnection>> {
  const url = watchPluginUrlFrom(process.env);
  const origin = (await headers()).get('origin');
  if (url === undefined) {
    return NOT_HERE;
  }
  if (origin === null) {
    return { kind: 'refused', message: 'Connect from the console' };
  }
  const calls = pluginCalls({ serverUrl: serverInternalUrlFrom(process.env), pluginUrl: url }, { cookie: await sessionCookie(), origin });
  try {
    const connection = await connectPlugin(calls, { ship: WATCH_PLUGIN_SHIP, newKey: () => crypto.randomUUID() });
    return { kind: 'answered', data: await shownConnection(calls, { connection, wanted: WATCH_PLUGIN_SHIP }) };
  } catch (error) {
    return refusalOf(error);
  }
}
