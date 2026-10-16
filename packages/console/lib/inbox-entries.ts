import type { InboxMessage, ShipId } from '@aeolus-fleet/common';

import { NETWORKING_PLUGIN_SHIP, SQUADRONS_SHIP, TRIERARCH_PLUGIN_SHIP } from './connect-plugin';
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
const PLUGIN_SHIP_TYPES: ReadonlySet<string> = new Set([TRIERARCH_TYPE, SQUADRONS_SHIP.type, TRIERARCH_PLUGIN_SHIP.type, NETWORKING_PLUGIN_SHIP.type]);

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
