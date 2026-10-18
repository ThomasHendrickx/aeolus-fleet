import type { ReachRefusal } from '@aeolus-fleet/common';

import { listed } from '../../../lib/labels';
import { WHILE_UNAVAILABLE_WORDS } from './network-declaration';

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
