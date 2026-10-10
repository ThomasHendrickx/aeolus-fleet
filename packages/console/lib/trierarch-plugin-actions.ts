'use server';

import { headers } from 'next/headers';

import { connectPlugin, TRIERARCH_PLUGIN_SHIP } from './connect-plugin';
import type { PluginAnswer } from './plugin-answer';
import { pluginCalls } from './plugin-calls';
import { serverInternalUrlFrom } from './server-url';
import { shownConnectionOf, type ShownConnection } from './shown-connection';
import { call, NOT_HERE, refusalOf, sessionCookie } from './trierarch-plugin-reads';
import { joinedMachineSchema, type JoinedMachine } from './trierarch-plugin-schemas';
import { trierarchPluginUrlFrom } from './trierarch-plugin-url';

/**
 * The trierarch plugin's mutations as the browser reaches them (decisions
 * 0030, 0033): server functions on the web app's server, calling the plugin
 * as its reads do (lib/trierarch-plugin-reads.ts). Next.js takes a server
 * function only from the console's own origin.
 */

/**
 * Connect the trierarch plugin, the operator's one button (decision 0030):
 * commissions its ship, trierarch-plugin with fleet:read, fleet:manage,
 * crew:assign, labels:define and labels:assign, or gives it a new starting
 * prompt, and hands its secret to the plugin, server to server. The browser
 * gets the connection only. The request's Origin goes along to the fleet,
 * which takes the session's state-changing calls only from the console.
 */
export async function connectTrierarchPlugin(): Promise<PluginAnswer<ShownConnection>> {
  const url = trierarchPluginUrlFrom(process.env);
  const origin = (await headers()).get('origin');
  if (url === undefined) {
    return NOT_HERE;
  }
  if (origin === null) {
    return { kind: 'refused', message: 'Connect from the console' };
  }
  const calls = pluginCalls({ serverUrl: serverInternalUrlFrom(process.env), pluginUrl: url }, { cookie: await sessionCookie(), origin });
  try {
    return { kind: 'answered', data: shownConnectionOf(await connectPlugin(calls, { ship: TRIERARCH_PLUGIN_SHIP, newKey: () => crypto.randomUUID() })) };
  } catch (error) {
    return refusalOf(error);
  }
}

export async function joinMachine(name: string): Promise<PluginAnswer<JoinedMachine>> {
  return call('machines.join', { input: { name }, isMutation: true, answers: joinedMachineSchema });
}
