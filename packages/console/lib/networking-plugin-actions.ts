'use server';

import type { NetworkRule } from '@aeolus-fleet/common';
import { cookies, headers } from 'next/headers';
import type { z } from 'zod';

import { ConnectPluginError, connectPlugin, NETWORKING_PLUGIN_SHIP } from './connect-plugin';
import { networkingPluginUrlFrom } from './networking-plugin-url';
import { networkSchema, savedDeclarationSchema, savedRulesSchema, type Network, type NetworkDeclaration, type SavedDeclaration, type SavedRules } from './networking-plugin-schemas';
import type { PluginAnswer } from './plugin-answer';
import { callPlugin, sessionCookieOf } from './plugin-call';
import { pluginCalls, readPluginConnection } from './plugin-calls';
import { serverInternalUrlFrom } from './server-url';
import { shownConnectionOf, type ShownConnection } from './shown-connection';

/**
 * The networking plugin as the browser reaches it (decisions 0033, 0036):
 * server functions on the web app's server, each calling the plugin with the
 * operator's console session and parsing its answer, so the browser gets only
 * the data it renders. Without the plugin, or while it is off for this fleet,
 * the browser learns only `none`. The network is argo's alone: the plugin
 * refuses any other session.
 */

const PLUGIN = 'the networking plugin';

const NOT_HERE: PluginAnswer<never> = { kind: 'refused', message: 'This console has no networking plugin' };

async function sessionCookie(): Promise<string> {
  return sessionCookieOf((await cookies()).toString());
}

async function call<T>(procedure: string, request: { input?: unknown; isMutation?: boolean; answers: z.ZodType<T> }): Promise<PluginAnswer<T>> {
  const url = networkingPluginUrlFrom(process.env);
  if (url === undefined) {
    return NOT_HERE;
  }
  return callPlugin({ plugin: PLUGIN, url, procedure, cookie: await sessionCookie(), ...request });
}

/** A refusal's words are safe to show; anything else says only that the networking plugin or the fleet did not answer. */
function refusalOf(error: unknown): PluginAnswer<never> {
  return { kind: 'refused', message: error instanceof ConnectPluginError ? error.message : 'the networking plugin or the fleet did not answer: try again in a moment' };
}

/** The networking plugin's connection as the browser may know it: `none` without the plugin or while it is off. */
export async function readNetworkingPluginConnection(): Promise<PluginAnswer<ShownConnection>> {
  const url = networkingPluginUrlFrom(process.env);
  if (url === undefined) {
    return { kind: 'answered', data: shownConnectionOf(undefined) };
  }
  try {
    return { kind: 'answered', data: shownConnectionOf(await readPluginConnection(url, await sessionCookie())) };
  } catch (error) {
    return refusalOf(error);
  }
}

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

export async function readNetwork(): Promise<PluginAnswer<Network>> {
  return call('network.get', { answers: networkSchema });
}

/** Saves the whole list, or none for all-to-all; the plugin supplies it to the fleet at once. */
export async function saveNetworkRules(rules: NetworkRule[] | null): Promise<PluginAnswer<SavedRules>> {
  return call('network.setRules', { input: { rules }, isMutation: true, answers: savedRulesSchema });
}

/** Saves what the plugin declares for while it is unavailable; it registers again with it at once. */
export async function saveNetworkDeclaration(declaration: NetworkDeclaration): Promise<PluginAnswer<SavedDeclaration>> {
  return call('network.setDeclaration', { input: declaration, isMutation: true, answers: savedDeclarationSchema });
}
