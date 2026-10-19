import type { ReachRefusal } from '@aeolus-fleet/common';

import { listed } from '../../../lib/labels';
import { WHILE_UNAVAILABLE_WORDS } from './network-declaration';

/** Who a refusal refused, by name: a ship by its name, an account by its id only (decision 0057), or the installation. */
export function refusedActorName(sender: ReachRefusal['sender']): string {
  switch (sender.kind) {
    case 'ship':
      return sender.name;
    case 'account':
      return `Account ${sender.accountId}`;
    case 'installation':
      return 'The installation';
  }
}

/** "scout tried to message vault.", or for a type, each ship of it the sender could not reach; an account or the installation tried to reach it. */
export function refusalSentenceOf(refusal: ReachRefusal): string {
  const { sender, recipient } = refusal;
  const tried = `${refusedActorName(sender)} tried to ${sender.kind === 'ship' ? 'message' : 'reach'}`;
  switch (recipient.kind) {
    case 'ship':
      return `${tried} ${recipient.ship.name}.`;
    case 'type':
      return `${tried} the type ${recipient.type}: ${listed(recipient.ships.map((ship) => ship.name))}.`;
  }
}

/** The network settings version that refused it, and what the networking plugin declared when it refused because the plugin was not responding. */
export function refusalCauseOf(refusal: ReachRefusal): string {
  const version = `Refused by network settings version ${String(refusal.settingsVersion)}`;
  return refusal.whilePluginUnavailable === null
    ? `${version}.`
    : `${version} while the networking plugin was not responding: ${WHILE_UNAVAILABLE_WORDS[refusal.whilePluginUnavailable].name}.`;
}
