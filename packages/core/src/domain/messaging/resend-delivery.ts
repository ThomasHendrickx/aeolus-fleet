import { isPingContentType, type DeliveryId, type IdGenerator, type MessageId } from '@aeolus-fleet/common';

import { checkReach, resolveSelector, type CheckReachTx, type NotReachable, type ResolveSelectorTx, type UnresolvableSelector } from '../registry/public.js';
import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import type { Notifier } from '../shared/notifier.js';
import { err, ok, type Result } from '../shared/result.js';
import { isAnswerToSender } from './answer.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { withinDailyMessageLimit, type DailyMessageLimitTx } from './daily-message-limit.js';
import { dismissForResend, type DismissRefusal } from './delivery.js';
import { acceptMessage, repeatOf, type AcceptRefusal, type RepeatRefusal } from './message.js';
import type { DeliveryRepository, MessageRepository, RequestHasher } from './ports.js';
import { sendRequestText } from './send-request.js';

export interface ResendDeliveryTx extends Omit<ResolveSelectorTx, 'ships'>, Omit<CheckReachTx, 'ships'>, DailyMessageLimitTx {
  ships: ResolveSelectorTx['ships'] & CheckReachTx['ships'];
  messages: MessageRepository;
  deliveries: DeliveryRepository;
  events: EventLog;
  notifier: Notifier;
}

export type ResendDeliveryRefusal =
  | DomainError<'DELIVERY_NOT_FOUND' | 'PING_NOT_RESENT'>
  | DismissRefusal
  | DomainError<'MESSAGE_LIMIT_REACHED'>
  | RepeatRefusal
  | UnresolvableSelector
  | NotReachable
  | AcceptRefusal;

export type ResendDelivery = (
  caller: Caller,
  input: { deliveryId: DeliveryId },
) => Promise<Result<{ messageId: MessageId }, ResendDeliveryRefusal>>;

/**
 * The idempotency key of a delivery's resend, the original sender's: one
 * resend per delivery, so a second one finds the first one's message.
 */
function resendKey(deliveryId: DeliveryId): string {
  return `resend-${deliveryId}`;
}

/**
 * Use case: the operator resends an undeliverable delivery from Needs
 * attention (docs/blueprint.md, "DeliveryUndeliverable"). Its scope
 * (fleet:manage) is checked before this runs. A resend is a retry of the same
 * delivery: a new message with the original's sender, selector, payload,
 * content type and reply, naming the message it resends, so an answer goes
 * back to whoever asked. In one unit of work it stores the message and its
 * pending delivery, MessageAccepted and DeliveryDismissed (both caused by the
 * operator), dismisses the original and wakes the receivers.
 *
 * A second resend of the delivery answers the first one's message and stores
 * nothing. When the selector no longer resolves, a retired ship or no ship of
 * the type left, the resend is refused and the original stays undeliverable,
 * for the operator to dismiss. A ping is never resent: it is dismissed, and
 * the ship pinged again through ping, so pings never stack. Locks, in this order: the original delivery,
 * then the resend's key, then the ship the message is addressed to, then the
 * fleet's network settings.
 *
 * A resend is a new message, checked by the network rules at its own send time
 * as the original sender sending (decision 0033): one no rule allows commits
 * only its refusal's record and is refused, and the original stays
 * undeliverable, for the operator to dismiss.
 */
export function createResendDelivery(deps: {
  uow: UnitOfWork<ResendDeliveryTx>;
  clock: Clock;
  ids: IdGenerator;
  hasher: RequestHasher;
}): ResendDelivery {
  return async (caller, input) => {
    const outcome = await deps.uow.run(async (tx): Promise<Result<{ messageId: MessageId } | { prevented: NotReachable }, ResendDeliveryRefusal>> => {
      const { fleetId } = caller;
      const delivery = await tx.deliveries.findForUpdate(fleetId, input.deliveryId);
      const original = delivery && (await tx.messages.find(fleetId, delivery.messageId));
      if (!delivery || !original) {
        return refuse('DELIVERY_NOT_FOUND', `Delivery ${input.deliveryId} does not exist`);
      }
      if (isPingContentType(original.contentType)) {
        return refuse('PING_NOT_RESENT', 'A ping is not resent: dismiss it, and ping the ship again');
      }

      const selector = original.selector;
      const inReplyTo = original.inReplyToMessageId ?? undefined;
      const requestHash = deps.hasher.hash(
        sendRequestText({ selector, payload: original.payload, contentType: original.contentType, inReplyTo }),
      );
      const senderKey = { fleetId, senderShipId: original.senderShipId, idempotencyKey: resendKey(delivery.id) };
      await tx.messages.lockIdempotencyKey(senderKey);
      const earlier = await tx.messages.findByIdempotencyKey(senderKey);
      if (earlier) {
        const repeat = repeatOf(earlier, requestHash);
        return repeat.isOk ? ok({ messageId: repeat.value }) : repeat;
      }

      const at = deps.clock.now();
      const dismissed = dismissForResend(delivery, { by: caller.shipId, at });
      if (!dismissed.isOk) {
        return dismissed;
      }
      const recipient = await resolveSelector(tx, { fleetId, selector });
      if (!recipient.isOk) {
        return recipient;
      }
      const repliedTo = inReplyTo === undefined ? undefined : await tx.messages.find(fleetId, inReplyTo);
      const repliedDelivery = repliedTo && (await tx.deliveries.findOfMessage(fleetId, repliedTo.id));
      const reach = await checkReach(
        { tx, ids: deps.ids },
        {
          fleetId,
          senderShipId: original.senderShipId,
          recipient: recipient.value,
          isAnswerToSender: isAnswerToSender(
            { senderShipId: original.senderShipId, recipient: recipient.value },
            repliedTo && repliedDelivery && { message: repliedTo, delivery: repliedDelivery },
          ),
          at,
        },
      );
      if (!reach.isOk) {
        // Nothing of the resend is stored yet: commit only the refusal's record.
        return ok({ prevented: reach.error });
      }
      const withinLimit = await withinDailyMessageLimit(tx, { fleetId, time: at });
      if (!withinLimit.isOk) {
        return withinLimit;
      }
      const accepted = acceptMessage(
        { recipient: recipient.value, repliedTo, ...reach.value },
        {
          messageId: deps.ids('message'),
          deliveryId: deps.ids('delivery'),
          fleetId,
          senderShipId: original.senderShipId,
          payload: original.payload,
          contentType: original.contentType,
          model: original.model ?? undefined,
          idempotencyKey: senderKey.idempotencyKey,
          requestHash,
          inReplyTo,
          resendOf: { messageId: original.id, by: caller.shipId },
          at,
        },
      );
      if (!accepted.isOk) {
        return accepted;
      }

      const { message, delivery: resent, events } = accepted.value;
      await tx.messages.create(message);
      await tx.deliveries.create(resent);
      await tx.deliveries.update(dismissed.value.delivery);
      for (const event of [...events, ...dismissed.value.events]) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      await tx.notifier.deliveryPending({ fleetId, deliveryId: resent.id, recipient: resent.recipient });
      return ok({ messageId: message.id });
    });
    if (!outcome.isOk) {
      return outcome;
    }
    return 'prevented' in outcome.value ? err(outcome.value.prevented) : ok(outcome.value);
  };
}
