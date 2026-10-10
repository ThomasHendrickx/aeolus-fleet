import { cookies } from 'next/headers';
import { z } from 'zod';

import { ConnectPluginError } from './connect-plugin';
import type { PluginAnswer } from './plugin-answer';
import { callPlugin, sessionCookieOf } from './plugin-call';
import { readPluginConnection } from './plugin-calls';
import { shownConnectionOf, type ShownConnection } from './shown-connection';
import { machineSchema, settingsCheckSchema, type Machine, type SettingsCheck } from './trierarch-plugin-schemas';
import { trierarchPluginUrlFrom } from './trierarch-plugin-url';
import { trierarchPluginVersionOf } from './version';

/**
 * The trierarch plugin as the browser reads it (decisions 0030, 0033):
 * console reads (lib/console-reads.ts) on the web app's server, each calling
 * the plugin with the operator's console session and parsing its answer, so
 * the browser gets only the data it renders. Without the plugin, or while it
 * is off for this fleet, the browser learns only `none`. Its mutations are
 * server functions (lib/trierarch-plugin-actions.ts), which share these calls.
 */

const PLUGIN = 'the trierarch plugin';

export const NOT_HERE: PluginAnswer<never> = { kind: 'refused', message: 'This console has no trierarch plugin' };

const VERSION_TIMEOUT_MS = 3_000;

export async function sessionCookie(): Promise<string> {
  return sessionCookieOf((await cookies()).toString());
}

export async function call<T>(procedure: string, request: { input?: unknown; isMutation?: boolean; answers: z.ZodType<T> }): Promise<PluginAnswer<T>> {
  const url = trierarchPluginUrlFrom(process.env);
  if (url === undefined) {
    return NOT_HERE;
  }
  return callPlugin({ plugin: PLUGIN, url, procedure, cookie: await sessionCookie(), ...request });
}

/** A refusal's words are safe to show; anything else says only that the trierarch plugin or the fleet did not answer. */
export function refusalOf(error: unknown): PluginAnswer<never> {
  return { kind: 'refused', message: error instanceof ConnectPluginError ? error.message : 'the trierarch plugin or the fleet did not answer: try again in a moment' };
}

/** The trierarch plugin's connection as the browser may know it: `none` without the plugin or while it is off. */
export async function readTrierarchPluginConnection(): Promise<PluginAnswer<ShownConnection>> {
  const url = trierarchPluginUrlFrom(process.env);
  if (url === undefined) {
    return { kind: 'answered', data: shownConnectionOf(undefined) };
  }
  try {
    return { kind: 'answered', data: shownConnectionOf(await readPluginConnection(url, await sessionCookie())) };
  } catch (error) {
    return refusalOf(error);
  }
}

/** The trierarch plugin's version, for the Trierarchs header (#332); undefined when it does not answer or the console has none. */
export async function readTrierarchPluginVersion(): Promise<string | undefined> {
  const url = trierarchPluginUrlFrom(process.env);
  if (url === undefined) {
    return undefined;
  }
  try {
    const response = await fetch(`${url}/api/version`, { cache: 'no-store', signal: AbortSignal.timeout(VERSION_TIMEOUT_MS) });
    const body: unknown = await response.json();
    return response.ok ? trierarchPluginVersionOf(body) : undefined;
  } catch {
    return undefined;
  }
}

export async function listMachines(): Promise<PluginAnswer<Machine[]>> {
  return call('machines.list', { answers: z.array(machineSchema) });
}

export async function checkCrewSettings(settings: unknown): Promise<PluginAnswer<SettingsCheck>> {
  return call('requests.check', { input: { settings }, answers: settingsCheckSchema });
}
