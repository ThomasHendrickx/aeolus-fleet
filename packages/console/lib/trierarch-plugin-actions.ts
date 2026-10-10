'use server';

import { cookies, headers } from 'next/headers';
import { z } from 'zod';

import { ConnectPluginError, connectPlugin, TRIERARCH_PLUGIN_SHIP } from './connect-plugin';
import type { PluginAnswer } from './plugin-answer';
import { callPlugin, sessionCookieOf } from './plugin-call';
import { pluginCalls, readPluginConnection } from './plugin-calls';
import { serverInternalUrlFrom } from './server-url';
import { shownConnectionOf, type ShownConnection } from './shown-connection';
import { joinedMachineSchema, machineSchema, settingsCheckSchema, type JoinedMachine, type Machine, type SettingsCheck } from './trierarch-plugin-schemas';
import { trierarchPluginUrlFrom } from './trierarch-plugin-url';
import { trierarchPluginVersionOf } from './version';

/**
 * The trierarch plugin as the browser reaches it (decisions 0030, 0033):
 * server functions on the web app's server, each calling the plugin with the
 * operator's console session and parsing its answer, so the browser gets only
 * the data it renders. Without the plugin, or while it is off for this fleet,
 * the browser learns only `none`. Next.js takes a server function only from
 * the console's own origin.
 */

const PLUGIN = 'the trierarch plugin';

const NOT_HERE: PluginAnswer<never> = { kind: 'refused', message: 'This console has no trierarch plugin' };

const VERSION_TIMEOUT_MS = 3_000;

async function sessionCookie(): Promise<string> {
  return sessionCookieOf((await cookies()).toString());
}

async function call<T>(procedure: string, request: { input?: unknown; isMutation?: boolean; answers: z.ZodType<T> }): Promise<PluginAnswer<T>> {
  const url = trierarchPluginUrlFrom(process.env);
  if (url === undefined) {
    return NOT_HERE;
  }
  return callPlugin({ plugin: PLUGIN, url, procedure, cookie: await sessionCookie(), ...request });
}

/** A refusal's words are safe to show; anything else says only that the trierarch plugin or the fleet did not answer. */
function refusalOf(error: unknown): PluginAnswer<never> {
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

export async function joinMachine(name: string): Promise<PluginAnswer<JoinedMachine>> {
  return call('machines.join', { input: { name }, isMutation: true, answers: joinedMachineSchema });
}

export async function checkCrewSettings(settings: unknown): Promise<PluginAnswer<SettingsCheck>> {
  return call('requests.check', { input: { settings }, answers: settingsCheckSchema });
}
