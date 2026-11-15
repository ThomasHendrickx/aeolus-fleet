import { WITHDRAWAL_CONTENT_TYPE, type FleetId, type IdGenerator, type MessageId, type ShipId } from '@aeolus-fleet/common';

import { recordEvent, type Actor } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import { sealedMessage, type DataKeysNeeded, type HeldDataKeys } from './data-keys.js';
import type { MeetingNoticeTx } from './meeting-notice.js';
import { acceptMessage, type AcceptRefusal } from './message.js';
import type { MessageRepository, OpenQuestion, RequestHasher } from './ports.js';
import { sendRequestText } from './send-request.js';

export interface RetiredAskerTx extends Omit<MeetingNoticeTx, 'messages'> {
  messages: Pick<MessageRepository, 'create' | 'listOpenQuestionsOf'>;
}

/** The open questions read at a time: each page is withdrawn before the next is read. */
const OPEN_QUESTIONS_PAGE = 100;

/**
 * Within the retire's unit of work, withdraws every question the retiring
 * ship asked that is still open (#1632, decision 0038): one withdrawal from
 * it to the ship it asked, naming the question's uuid, as its own `withdraw`
 * sends it, with its pending delivery, MessageAccepted caused by the retire's
 * actor, and the notice that wakes the asked ship. The asked ship then shows
 * the question as a withdrawn one goes, and no answer is written to a ship
 * that is never addressed again. No model: the retire is no session's
 * message. Which questions are open is read from the question uuids stored
 * at send, a page at a time, so no stored payload is opened: only the
 * withdrawal is sealed, under the current data key.
 */
export async function withdrawQuestionsOnRetire(
  deps: { tx: RetiredAskerTx; ids: IdGenerator; hasher: RequestHasher; held: HeldDataKeys },
  retire: { fleetId: FleetId; shipId: ShipId; actor: Actor; at: Date },
): Promise<Result<undefined, AcceptRefusal | DataKeysNeeded>> {
  let after: MessageId | undefined;
  for (;;) {
    const page = await deps.tx.messages.listOpenQuestionsOf(retire.fleetId, { shipId: retire.shipId, ...(after === undefined ? {} : { after }), limit: OPEN_QUESTIONS_PAGE });
    for (const open of page) {
      const withdrawn = await sendWithdrawal(deps, { ...retire, ...open });
      if (!withdrawn.isOk) {
        return withdrawn;
      }
    }
    const last = page.at(-1);
    if (page.length < OPEN_QUESTIONS_PAGE || last === undefined) {
      return ok(undefined);
    }
    after = last.messageId;
  }
}

/** The withdrawal of one question, stored as a send stores it: sealed in a sealed fleet (decision 0068). */
async function sendWithdrawal(
  deps: { tx: RetiredAskerTx; ids: IdGenerator; hasher: RequestHasher; held: HeldDataKeys },
  withdrawal: OpenQuestion & { fleetId: FleetId; shipId: ShipId; actor: Actor; at: Date },
): Promise<Result<undefined, AcceptRefusal | DataKeysNeeded>> {
  const { tx, ids, hasher } = deps;
  const { fleetId, at } = withdrawal;
  const recipient = { kind: 'ship' as const, shipId: withdrawal.askedShipId };
  const payload = JSON.stringify({ questionId: withdrawal.questionId });
  const contentType = WITHDRAWAL_CONTENT_TYPE;
  const messageId = ids('message');
  const accepted = acceptMessage(
    { recipient, repliedTo: undefined },
    {
      messageId,
      deliveryId: ids('delivery'),
      fleetId,
      senderShipId: withdrawal.shipId,
      payload,
      contentType,
      model: undefined,
      // The fleet's own key for the withdrawal, as a meeting notice's is: one per message.
      idempotencyKey: `retire-withdrawal-${messageId}`,
      requestHash: hasher.hash(sendRequestText({ selector: recipient, payload, contentType, inReplyTo: undefined, isForced: false })),
      inReplyTo: undefined,
      isForced: false,
      actor: withdrawal.actor,
      at,
    },
  );
  if (!accepted.isOk) {
    return accepted;
  }
  const message = await sealedMessage(deps, {
    message: accepted.value.message,
    sealedRequestHash: hasher.hash(sendRequestText({ selector: recipient, payload: undefined, contentType, inReplyTo: undefined, isForced: false })),
  });
  if (!message.isOk) {
    return message;
  }
  const { delivery, events } = accepted.value;
  await tx.messages.create(message.value);
  await tx.deliveries.create(delivery, message.value);
  for (const event of events) {
    await recordEvent({ events: tx.events, ids }, event);
  }
  await tx.notifier.deliveryPending({ fleetId, deliveryId: delivery.id, recipient: delivery.recipient });
  return ok(undefined);
}
