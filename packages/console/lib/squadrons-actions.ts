'use server';

import { headers } from 'next/headers';
import { z } from 'zod';

import { connectPlugin, SQUADRONS_SHIP, type PluginConnection } from './connect-plugin';
import type { PluginAnswer } from './plugin-answer';
import { pluginCalls } from './plugin-calls';
import { serverInternalUrlFrom } from './server-url';
import { shownConnectionOf, type ShownConnection } from './shown-connection';
import { addedMemberSchema, formedSquadronSchema, newCrewLineSchema, repositorySchema, type AddedMember, type FormedSquadron, type NewCrewLine, type TemplateRepository } from './squadrons-schemas';
import { call, NOT_HERE, refusalOf, sessionCookie } from './squadrons-reads';
import { squadronsUrlFrom } from './squadrons-url';

/**
 * squadrons' mutations as the browser reaches them (decisions 0017, 0033):
 * server functions on the web app's server, calling squadrons as its reads do
 * (lib/squadrons-reads.ts). Next.js takes a server function only from the
 * console's own origin.
 */

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

export async function addRepository(repository: { url: string; path?: string; token?: string }): Promise<PluginAnswer<TemplateRepository>> {
  return call('repositories.add', { input: repository, isMutation: true, answers: repositorySchema });
}

export async function removeRepository(name: string): Promise<PluginAnswer<unknown>> {
  return call('repositories.remove', { input: { name }, isMutation: true, answers: z.strictObject({}) });
}

export async function refreshCatalogue(): Promise<PluginAnswer<unknown>> {
  return call('catalogue.refresh', { isMutation: true, answers: z.strictObject({}) });
}
