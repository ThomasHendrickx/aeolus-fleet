'use client';

import type { ReachRefusal } from '@aeolus-fleet/common';
import { useQuery } from '@tanstack/react-query';

import { listed } from './labels';
import { WHILE_UNAVAILABLE_WORDS } from './network-declaration';
import { useTRPC } from './trpc';

/**
 * The reach refusals as argo reads them on Network (design point 7 on #260;
 * decision 0034): the sends the rules refused, newest first, each said as
 * who tried to message whom and what refused it.
 */

/** The fleet's latest reach refusals, newest first: asked only while Network shows. */
export function useReachRefusals(isShown: boolean) {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.reachRefusals.queryOptions(undefined, { enabled: isShown }));
}

/** "scout tried to message vault.", or for a type, each ship of it the sender could not reach. */
export function refusalSentenceOf(refusal: ReachRefusal): string {
  const { sender, recipient } = refusal;
  switch (recipient.kind) {
    case 'ship':
      return `${sender.name} tried to message ${recipient.ship.name}.`;
    case 'type':
      return `${sender.name} tried to message the type ${recipient.type}: ${listed(recipient.ships.map((ship) => ship.name))}.`;
  }
}

/** The network settings version that refused it, and what the networking plugin declared when it refused because the plugin was not responding. */
export function refusalCauseOf(refusal: ReachRefusal): string {
  const version = `Refused by network settings version ${String(refusal.settingsVersion)}`;
  return refusal.whilePluginUnavailable === null
    ? `${version}.`
    : `${version} while the networking plugin was not responding: ${WHILE_UNAVAILABLE_WORDS[refusal.whilePluginUnavailable].name}.`;
}
