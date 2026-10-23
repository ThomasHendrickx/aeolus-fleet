import type { DeliveryId, InboxMessage, ShipId } from '@aeolus-fleet/common';

import { GATEWAY_SHIP, SQUADRONS_SHIP, TRIERARCH_PLUGIN_SHIP } from './connect-plugin';
import type { InboxEntry, InboxSender } from './inbox-entry';
import { messageTextOf } from './message-text';
import { questionsIn } from './question-answer';
import { questionDeliveryIdsOf } from './questions';

/**
 * argo's inbox as the web app's server lays it out (#849): each question with
 * its answer and staleness, each other message with its headline and body,
 * marked when a plugin's ship sent it. The withdrawals that made a question
 * stale are left out (decision 0038).
 */

/** A trierarch's ship, as the trierarch plugin commissions it. */
const TRIERARCH_TYPE = 'trierarch';

/** The types of the ships plugins crew: their messages fold into one row. */
const PLUGIN_SHIP_TYPES: ReadonlySet<string> = new Set([TRIERARCH_TYPE, SQUADRONS_SHIP.type, TRIERARCH_PLUGIN_SHIP.type, GATEWAY_SHIP.type]);

export interface ListedShip {
  id: ShipId;
  name: string;
  type: string;
}

function senderOf(sender: { id: ShipId; name: string }, ships: readonly ListedShip[]): InboxSender {
  const type = ships.find(({ id }) => id === sender.id)?.type ?? null;
  const isNameShared = ships.some(({ id, name }) => id !== sender.id && name === sender.name);
  return { id: sender.id, name: sender.name, type, isNameShared };
}

export function inboxEntriesOf(inbox: readonly InboxMessage[], ships: readonly ListedShip[]): InboxEntry[] {
  const questions = questionsIn(inbox);
  const shownElsewhere = questionDeliveryIdsOf(questions);
  return inbox.flatMap((entry): InboxEntry[] => {
    const sender = senderOf(entry.message.sender, ships);
    const base = {
      deliveryId: entry.deliveryId,
      messageId: entry.message.id,
      state: entry.state,
      readAt: entry.readAt,
      doneAt: entry.doneAt,
      sender,
      sentAt: entry.message.sentAt,
      model: entry.message.model,
    };
    const asked = questions.find(({ deliveryId }) => deliveryId === entry.deliveryId);
    if (asked !== undefined) {
      return [{ ...base, kind: 'question', question: asked.question, stale: asked.stale, replaces: asked.replaces }];
    }
    if (shownElsewhere.has(entry.deliveryId)) {
      return [];
    }
    return [
      {
        ...base,
        kind: 'message',
        isFromPlugin: sender.type !== null && PLUGIN_SHIP_TYPES.has(sender.type),
        repliedWith: entry.repliedWith,
        inReplyTo: entry.message.inReplyTo,
        text: messageTextOf(entry.message),
        replies: entry.replies.map((reply) => ({ id: reply.id, sentAt: reply.sentAt, text: messageTextOf(reply) })),
      },
    ];
  });
}

/** The question or message with this delivery, laid out with the newer messages that make it stale; null when the inbox does not hold it. */
export function inboxEntryOf(inbox: readonly InboxMessage[], { ships, deliveryId }: { ships: readonly ListedShip[]; deliveryId: DeliveryId }): InboxEntry | null {
  return inboxEntriesOf(inbox, ships).find((entry) => entry.deliveryId === deliveryId) ?? null;
}

/**
 * The open messages laid out with the newer ones read beside them: a question
 * is stale by a withdrawal or replacement that is newer and need not be open
 * (decision 0038). Only the open ones, in their order.
 */
export function openEntriesOf(open: readonly InboxMessage[], { newer, ships }: { newer: readonly InboxMessage[]; ships: readonly ListedShip[] }): InboxEntry[] {
  const openIds = new Set(open.map(({ deliveryId }) => deliveryId));
  const laidOut = new Map(inboxEntriesOf([...open, ...newer.filter(({ deliveryId }) => !openIds.has(deliveryId))], ships).map((entry) => [entry.deliveryId, entry]));
  return open.flatMap(({ deliveryId }) => laidOut.get(deliveryId) ?? []);
}
