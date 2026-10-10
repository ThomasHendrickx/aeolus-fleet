'use server';

import type { NetworkRule } from '@aeolus-fleet/common';
import { headers } from 'next/headers';

import { connectPlugin, NETWORKING_PLUGIN_SHIP } from './connect-plugin';
import { call, NOT_HERE, refusalOf, sessionCookie } from './networking-plugin-reads';
import { savedDeclarationSchema, savedRulesSchema, type NetworkDeclaration, type SavedDeclaration, type SavedRules } from './networking-plugin-schemas';
import { networkingPluginUrlFrom } from './networking-plugin-url';
import type { PluginAnswer } from './plugin-answer';
import { pluginCalls } from './plugin-calls';
import { serverInternalUrlFrom } from './server-url';
import { shownConnectionOf, type ShownConnection } from './shown-connection';

/**
 * The networking plugin's mutations as the browser reaches them (decisions
 * 0033, 0036): server functions on the web app's server, calling the plugin
 * as its reads do (lib/networking-plugin-reads.ts).
 */

/**
 * Connect the networking plugin, the operator's one button (decision 0036):
 * commissions its ship, networking-plugin with fleet:read and fleet:network,
 * or gives it a new starting prompt, and hands its secret to the plugin,
 * server to server. The browser gets the connection only.
 */
export async function connectNetworkingPlugin(): Promise<PluginAnswer<ShownConnection>> {
  const url = networkingPluginUrlFrom(process.env);
  const origin = (await headers()).get('origin');
  if (url === undefined) {
    return NOT_HERE;
  }
  if (origin === null) {
    return { kind: 'refused', message: 'Connect from the console' };
  }
  const calls = pluginCalls({ serverUrl: serverInternalUrlFrom(process.env), pluginUrl: url }, { cookie: await sessionCookie(), origin });
  try {
    return { kind: 'answered', data: shownConnectionOf(await connectPlugin(calls, { ship: NETWORKING_PLUGIN_SHIP, newKey: () => crypto.randomUUID() })) };
  } catch (error) {
    return refusalOf(error);
  }
}

/** Saves the whole list, or none for all-to-all; the plugin supplies it to the fleet at once. */
export async function saveNetworkRules(rules: NetworkRule[] | null): Promise<PluginAnswer<SavedRules>> {
  return call('network.setRules', { input: { rules }, isMutation: true, answers: savedRulesSchema });
}

/** Saves what the plugin declares for while it is unavailable; it registers again with it at once. */
export async function saveNetworkDeclaration(declaration: NetworkDeclaration): Promise<PluginAnswer<SavedDeclaration>> {
  return call('network.setDeclaration', { input: declaration, isMutation: true, answers: savedDeclarationSchema });
}
