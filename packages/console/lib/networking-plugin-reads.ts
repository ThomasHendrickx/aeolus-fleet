import { cookies } from 'next/headers';
import type { z } from 'zod';

import { ConnectPluginError } from './connect-plugin';
import { networkingPluginUrlFrom } from './networking-plugin-url';
import { networkSchema, type Network } from './networking-plugin-schemas';
import type { PluginAnswer } from './plugin-answer';
import { callPlugin, sessionCookieOf } from './plugin-call';
import { readPluginConnection } from './plugin-calls';
import { shownConnectionOf, type ShownConnection } from './shown-connection';

/**
 * The networking plugin as the browser reads it (decisions 0033, 0036):
 * console reads (lib/console-reads.ts) on the web app's server, each calling
 * the plugin with the operator's console session and parsing its answer, so
 * the browser gets only the data it renders. Without the plugin, or while it
 * is off for this fleet, the browser learns only `none`. The network is
 * argo's alone: the plugin refuses any other session. Its mutations are
 * server functions (lib/networking-plugin-actions.ts), which share these calls.
 */

const PLUGIN = 'the networking plugin';

export const NOT_HERE: PluginAnswer<never> = { kind: 'refused', message: 'This console has no networking plugin' };

export async function sessionCookie(): Promise<string> {
  return sessionCookieOf((await cookies()).toString());
}

export async function call<T>(procedure: string, request: { input?: unknown; isMutation?: boolean; answers: z.ZodType<T> }): Promise<PluginAnswer<T>> {
  const url = networkingPluginUrlFrom(process.env);
  if (url === undefined) {
    return NOT_HERE;
  }
  return callPlugin({ plugin: PLUGIN, url, procedure, cookie: await sessionCookie(), ...request });
}

/** A refusal's words are safe to show; anything else says only that the networking plugin or the fleet did not answer. */
export function refusalOf(error: unknown): PluginAnswer<never> {
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

export async function readNetwork(): Promise<PluginAnswer<Network>> {
  return call('network.get', { answers: networkSchema });
}
