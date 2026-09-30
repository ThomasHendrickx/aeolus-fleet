import type { IdGenerator, MessageId } from '@aeolus-fleet/common';

import { resolveSelector, type ResolveSelectorTx, type UnresolvableSelector } from '../registry/public.js';
import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { Selector } from '../shared/selector.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { contentType } from './content-type.js';
import { idempotencyKey } from './idempotency-key.js';
import { acceptMessage, repeatOf, type AcceptRefusal, type RepeatRefusal } from './message.js';
import { payload } from './payload.js';
import type { DeliveryRepository, MessageRepository, Notifier, RequestHasher } from './ports.js';
import { sendRequestText } from './send-request.js';

export interface SendMessageTx extends ResolveSelectorTx {
  messages: MessageRepository;
  deliveries: DeliveryRepository;
  events: EventLog;
  notifier: Notifier;
}

export interface MessageToSend {
  selector: Selector;
  payload: string;
  /** Any well-formed media type, passed on untouched. */
  contentType: string;
  idempotencyKey: string;
  /** The id of the message, in the same fleet, this one replies to. */
  inReplyTo?: MessageId;
}

export interface MessageSent {
  /** The message's id: the original one when the sender used the idempotency key before. */
  messageId: MessageId;
}

export type SendMessageRefusal =
  | DomainError<'PAYLOAD_TOO_LARGE' | 'INVALID_CONTENT_TYPE' | 'INVALID_IDEMPOTENCY_KEY'>
  | RepeatRefusal
  | UnresolvableSelector
  | AcceptRefusal;

export type SendMessage = (caller: Caller, input: MessageToSend) => Promise<Result<MessageSent, SendMessageRefusal>>;

/**
 * Use case: the calling ship sends a message (`send`). The sender is always
 * the caller, `argo` included; its scope (messages:send) is checked before
 * this runs. The message, its delivery, MessageAccepted and the notice that
 * wakes its receivers are one unit of work: the sender gets its id only once
 * all of it is committed (ADR 0003). A payload over 64 KB, a content type that
 * is no media type or a bad key is refused before the unit of work starts, so
 * nothing is stored.
 *
 * A repeat, the same sender with the same idempotency key and the same
 * request, returns the original message's id and stores nothing; the same key
 * with another request is refused. The key is checked before the selector, so
 * a retry still gets its OK after the recipient was retired. Locks, in this
 * order: the sender's key, so two sends with one key take turns and the second
 * finds the first one's message; then the ship the message is addressed to,
 * held against a retire.
 */
export function createSendMessage(deps: {
  uow: UnitOfWork<SendMessageTx>;
  clock: Clock;
  ids: IdGenerator;
  hasher: RequestHasher;
}): SendMessage {
  return async (caller, input) => {
    const text = payload(input.payload);
    if (!text.isOk) {
      return text;
    }
    const mediaType = contentType(input.contentType);
    if (!mediaType.isOk) {
      return mediaType;
    }
    const key = idempotencyKey(input.idempotencyKey);
    if (!key.isOk) {
      return key;
    }
    const { inReplyTo } = input;
    const requestHash = deps.hasher.hash(
      sendRequestText({ selector: input.selector, payload: text.value, contentType: mediaType.value, inReplyTo }),
    );

    return deps.uow.run(async (tx): Promise<Result<MessageSent, SendMessageRefusal>> => {
      const { fleetId, shipId: senderShipId } = caller;
      const senderKey = { fleetId, senderShipId, idempotencyKey: key.value };
      await tx.messages.lockIdempotencyKey(senderKey);
      const original = await tx.messages.findByIdempotencyKey(senderKey);
      if (original) {
        const repeat = repeatOf(original, requestHash);
        return repeat.isOk ? ok({ messageId: repeat.value }) : repeat;
      }

      const recipient = await resolveSelector(tx, { fleetId, selector: input.selector });
      if (!recipient.isOk) {
        return recipient;
      }
      const repliedTo = inReplyTo === undefined ? undefined : await tx.messages.find(fleetId, inReplyTo);
      const accepted = acceptMessage(
        { recipient: recipient.value, repliedTo },
        {
          messageId: deps.ids('message'),
          deliveryId: deps.ids('delivery'),
          fleetId,
          senderShipId,
          payload: text.value,
          contentType: mediaType.value,
          idempotencyKey: key.value,
          requestHash,
          inReplyTo,
          at: deps.clock.now(),
        },
      );
      if (!accepted.isOk) {
        return accepted;
      }

      const { message, delivery, events } = accepted.value;
      await tx.messages.create(message);
      await tx.deliveries.create(delivery);
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      await tx.notifier.deliveryPending({ fleetId, deliveryId: delivery.id, recipient: delivery.recipient });
      return ok({ messageId: message.id });
    });
  };
}
