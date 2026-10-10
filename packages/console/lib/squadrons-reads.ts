import { cookies } from 'next/headers';
import { z } from 'zod';

import { ConnectPluginError } from './connect-plugin';
import type { PluginAnswer } from './plugin-answer';
import { callPlugin, sessionCookieOf } from './plugin-call';
import { readPluginConnection } from './plugin-calls';
import { shownConnectionOf, type ShownConnection } from './shown-connection';
import {
  catalogueSchema,
  keptMessageSchema,
  memberDraftSchema,
  repositorySchema,
  squadronSchema,
  type Catalogue,
  type KeptMessage,
  type MemberDraft,
  type Squadron,
  type TemplateRepository,
} from './squadrons-schemas';
import { squadronsUrlFrom } from './squadrons-url';

/**
 * squadrons as the browser reads it (decisions 0017, 0033): console reads
 * (lib/console-reads.ts) on the web app's server, each calling squadrons with
 * the operator's console session and parsing its answer, so the browser gets
 * only the data it renders. Without squadrons, or while it is off for this
 * fleet, the browser learns only `none`. Its mutations are server functions
 * (lib/squadrons-actions.ts), which share these calls.
 */

const PLUGIN = 'squadrons';

export const NOT_HERE: PluginAnswer<never> = { kind: 'refused', message: 'This console has no squadrons' };

export async function sessionCookie(): Promise<string> {
  return sessionCookieOf((await cookies()).toString());
}

export async function call<T>(procedure: string, request: { input?: unknown; isMutation?: boolean; answers: z.ZodType<T> }): Promise<PluginAnswer<T>> {
  const url = squadronsUrlFrom(process.env);
  if (url === undefined) {
    return NOT_HERE;
  }
  return callPlugin({ plugin: PLUGIN, url, procedure, cookie: await sessionCookie(), ...request });
}

/** A refusal's words are safe to show; anything else says only that squadrons or the fleet did not answer. */
export function refusalOf(error: unknown): PluginAnswer<never> {
  return { kind: 'refused', message: error instanceof ConnectPluginError ? error.message : 'squadrons or the fleet did not answer: try again in a moment' };
}

/** squadrons' connection as the browser may know it: `none` without squadrons or while it is off. */
export async function readSquadronsConnection(): Promise<PluginAnswer<ShownConnection>> {
  const url = squadronsUrlFrom(process.env);
  if (url === undefined) {
    return { kind: 'answered', data: shownConnectionOf(undefined) };
  }
  try {
    return { kind: 'answered', data: shownConnectionOf(await readPluginConnection(url, await sessionCookie())) };
  } catch (error) {
    return refusalOf(error);
  }
}

export async function listSquadrons(): Promise<PluginAnswer<Squadron[]>> {
  return call('squadrons.list', { answers: z.array(squadronSchema) });
}

export async function readKeptMessages(squadronId: string): Promise<PluginAnswer<KeptMessage[]>> {
  return call('squadrons.messages', { input: { squadronId }, answers: z.array(keptMessageSchema) });
}

export async function readCatalogue(): Promise<PluginAnswer<Catalogue>> {
  return call('catalogue.list', { answers: catalogueSchema });
}

export async function readBlueprintCrew(blueprint: { repository: string; name: string; version: number }): Promise<PluginAnswer<MemberDraft[]>> {
  return call('catalogue.blueprintCrew', { input: { blueprint }, answers: z.array(memberDraftSchema) });
}

export async function listRepositories(): Promise<PluginAnswer<TemplateRepository[]>> {
  return call('repositories.list', { answers: z.array(repositorySchema) });
}
