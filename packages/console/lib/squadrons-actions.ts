'use server';

import { cookies, headers } from 'next/headers';
import { z } from 'zod';

import { ConnectPluginError, connectPlugin, SQUADRONS_SHIP, type PluginConnection } from './connect-plugin';
import type { PluginAnswer } from './plugin-answer';
import { callPlugin, sessionCookieOf } from './plugin-call';
import { pluginCalls, readPluginConnection } from './plugin-calls';
import { serverInternalUrlFrom } from './server-url';
import { shownConnectionOf, type ShownConnection } from './shown-connection';
import {
  addedMemberSchema,
  catalogueSchema,
  formedSquadronSchema,
  keptMessageSchema,
  memberDraftSchema,
  newCrewLineSchema,
  repositorySchema,
  squadronSchema,
  type AddedMember,
  type Catalogue,
  type FormedSquadron,
  type KeptMessage,
  type MemberDraft,
  type NewCrewLine,
  type Squadron,
  type TemplateRepository,
} from './squadrons-schemas';
import { squadronsUrlFrom } from './squadrons-url';

/**
 * squadrons as the browser reaches it (decisions 0017, 0033): server
 * functions on the web app's server, each calling squadrons with the
 * operator's console session and parsing its answer, so the browser gets only
 * the data it renders. Without squadrons, or while it is off for this fleet,
 * the browser learns only `none`. Next.js takes a server function only from
 * the console's own origin.
 */

const PLUGIN = 'squadrons';

const NOT_HERE: PluginAnswer<never> = { kind: 'refused', message: 'This console has no squadrons' };

async function sessionCookie(): Promise<string> {
  return sessionCookieOf((await cookies()).toString());
}

async function call<T>(procedure: string, request: { input?: unknown; isMutation?: boolean; answers: z.ZodType<T> }): Promise<PluginAnswer<T>> {
  const url = squadronsUrlFrom(process.env);
  if (url === undefined) {
    return NOT_HERE;
  }
  return callPlugin({ plugin: PLUGIN, url, procedure, cookie: await sessionCookie(), ...request });
}

/** A refusal's words are safe to show; anything else says only that squadrons or the fleet did not answer. */
function refusalOf(error: unknown): PluginAnswer<never> {
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

/**
 * Connect squadrons, the operator's one button: commissions the management
 * ship or gives it a new starting prompt, and hands its secret to squadrons,
 * server to server. The browser gets the connection only. The request's Origin
 * goes along to the fleet, which takes the session's state-changing calls only
 * from the console.
 */
export async function connectSquadrons(): Promise<PluginAnswer<ShownConnection>> {
  const url = squadronsUrlFrom(process.env);
  const origin = (await headers()).get('origin');
  if (url === undefined) {
    return NOT_HERE;
  }
  if (origin === null) {
    return { kind: 'refused', message: 'Connect from the console' };
  }
  const calls = pluginCalls({ serverUrl: serverInternalUrlFrom(process.env), pluginUrl: url }, { cookie: await sessionCookie(), origin });
  try {
    const connection: PluginConnection = await connectPlugin(calls, { ship: SQUADRONS_SHIP, newKey: () => crypto.randomUUID() });
    return { kind: 'answered', data: shownConnectionOf(connection) };
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

export async function formSquadron(input: { blueprint: { repository: string; name: string; version: number }; members?: unknown }): Promise<PluginAnswer<FormedSquadron>> {
  return call('squadrons.form', { input, isMutation: true, answers: formedSquadronSchema });
}

export async function standDown(squadronId: string): Promise<PluginAnswer<unknown>> {
  return call('squadrons.standDown', { input: { squadronId }, isMutation: true, answers: z.object({}) });
}

export async function forceStandDown(squadronId: string): Promise<PluginAnswer<unknown>> {
  return call('squadrons.forceStandDown', { input: { squadronId }, isMutation: true, answers: z.object({}) });
}

export async function addMember(member: { squadronId: string; role: string }): Promise<PluginAnswer<AddedMember>> {
  return call('squadrons.addMember', { input: member, isMutation: true, answers: addedMemberSchema });
}

export async function removeMember(member: { squadronId: string; shipId: string }): Promise<PluginAnswer<unknown>> {
  return call('squadrons.removeMember', { input: member, isMutation: true, answers: z.strictObject({}) });
}

export async function newCrewLine(member: { squadronId: string; shipId: string }): Promise<PluginAnswer<NewCrewLine>> {
  return call('squadrons.newCrewLine', { input: member, isMutation: true, answers: newCrewLineSchema });
}

export async function listRepositories(): Promise<PluginAnswer<TemplateRepository[]>> {
  return call('repositories.list', { answers: z.array(repositorySchema) });
}

export async function addRepository(repository: { url: string; path?: string; token?: string }): Promise<PluginAnswer<TemplateRepository>> {
  return call('repositories.add', { input: repository, isMutation: true, answers: repositorySchema });
}

export async function removeRepository(name: string): Promise<PluginAnswer<unknown>> {
  return call('repositories.remove', { input: { name }, isMutation: true, answers: z.strictObject({}) });
}

export async function refreshCatalogue(): Promise<PluginAnswer<unknown>> {
  return call('catalogue.refresh', { isMutation: true, answers: z.strictObject({}) });
}
