import type { DeliveryId, IdGenerator, MessageId } from '@aeolus-fleet/common';

import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { markDoneWithin, type MarkDoneTx, type MarkDoneUseCaseRefusal } from './mark-done.js';
import type { RequestHasher } from './ports.js';
import { checkedSend, sendWithin, type SendMessageRefusal, type SendMessageTx } from './send-message.js';

export type ReplyToMessageTx = SendMessageTx & MarkDoneTx;

export type ReplyToMessageRefusal = DomainError<'DELIVERY_NOT_FOUND' | 'NOT_THE_OPERATOR_SHIP'> | SendMessageRefusal | MarkDoneUseCaseRefusal;

export type ReplyToMessage = (
  crew: Crew,
  input: { deliveryId: DeliveryId; payload: string; idempotencyKey: string },
) => Promise<Result<{ messageId: MessageId }, ReplyToMessageRefusal>>;

/**
 * Use case: argo replies to a message to it from the operator inbox
 * (docs/blueprint.md, "Inbox"). Its scopes (messages:send and
 * messages:receive) are checked before this runs. One unit of work: the reply
 * as plain text from argo to the message's sender, naming the message, as a
 * send would store it, and the message marked done, its acknowledgement
 * naming the reply. A message already done stays done; the reply is a new
 * message all the same. A repeat of the key answers the same reply. Any
 * refusal, a retired sender included, sends nothing and leaves the message
 * open.
 */
export function createReplyToMessage(deps: {
  uow: UnitOfWork<ReplyToMessageTx>;
  clock: Clock;
  ids: IdGenerator;
  hasher: RequestHasher;
}): ReplyToMessage {
  return async (crew, input) => {
    if (crew.kind !== 'operator') {
      return refuse('NOT_THE_OPERATOR_SHIP', 'Only argo replies from the operator inbox; a ship sends its answer');
    }
    return deps.uow.run(async (tx): Promise<Result<{ messageId: MessageId }, ReplyToMessageRefusal>> => {
      const { fleetId } = crew;
      const delivery = await tx.deliveries.findForUpdate(fleetId, input.deliveryId);
      const asked = delivery && (await tx.messages.find(fleetId, delivery.messageId));
      if (!delivery || !asked || delivery.recipient.kind !== 'ship' || delivery.recipient.shipId !== crew.shipId) {
        return refuse('DELIVERY_NOT_FOUND', `Delivery ${input.deliveryId} is not in your inbox`);
      }
      const request = checkedSend(
        {
          selector: { kind: 'ship', shipId: asked.senderShipId },
          payload: input.payload,
          contentType: 'text/plain',
          idempotencyKey: input.idempotencyKey,
          inReplyTo: asked.id,
        },
        deps.hasher,
      );
      if (!request.isOk) {
        return request;
      }
      const inTx = { tx, clock: deps.clock, ids: deps.ids };
      const sent = await sendWithin(inTx, { caller: crew, request: request.value });
      if (!sent.isOk) {
        return sent;
      }
      const done = await markDoneWithin(inTx, { crew, deliveryId: delivery.id, reply: sent.value.messageId });
      return done.isOk ? ok(sent.value) : done;
    });
  };
}
