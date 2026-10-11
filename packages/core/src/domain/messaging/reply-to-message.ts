import type { DeliveryId, FleetId, IdGenerator, MessageId } from '@aeolus-fleet/common';

import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { isInInboxOf } from './delivery.js';
import { markDoneWithin, type MarkDoneTx, type MarkDoneUseCaseRefusal } from './mark-done.js';
import type { Delivery, Message } from './message.js';
import type { RequestHasher } from './ports.js';
import { checkedSend, sendWithin, type SendMessageRefusal, type SendMessageTx } from './send-message.js';

export type ReplyToMessageTx = SendMessageTx & MarkDoneTx;

export type ReplyToMessageRefusal = DomainError<'DELIVERY_NOT_FOUND' | 'NOT_THE_OPERATOR_SHIP'> | SendMessageRefusal | MarkDoneUseCaseRefusal;

export type ReplyToMessage = (
  crew: Crew,
  input: { deliveryId: DeliveryId; payload: string; idempotencyKey: string },
) => Promise<Result<{ messageId: MessageId }, ReplyToMessageRefusal>>;

interface InTx {
  tx: ReplyToMessageTx;
  clock: Clock;
  ids: IdGenerator;
  hasher: RequestHasher;
}

/** A delivery to argo and the message it carries, locked for a reply; refused when it is not in argo's inbox. */
export async function repliedToWithin(
  tx: ReplyToMessageTx,
  { fleetId, crew, deliveryId }: { fleetId: FleetId; crew: Crew; deliveryId: DeliveryId },
): Promise<Result<{ delivery: Delivery; asked: Message }, DomainError<'DELIVERY_NOT_FOUND'>>> {
  const delivery = await tx.deliveries.findForUpdate(fleetId, deliveryId);
  const asked = delivery && (await tx.messages.find(fleetId, delivery.messageId));
  if (!isInInboxOf(delivery, crew.shipId) || !asked) {
    return refuse('DELIVERY_NOT_FOUND', `Delivery ${deliveryId} is not in your inbox`);
  }
  return ok({ delivery, asked });
}

/**
 * argo's reply to a message in its inbox, inside the caller's unit of work:
 * sent to the message's sender naming it, as a send would store it, and the
 * message marked done, its acknowledgement naming the reply. A message
 * already done stays done.
 */
export async function replyWithin(
  inTx: InTx,
  reply: { crew: Crew; delivery: Delivery; asked: Message; payload: string; contentType: string; idempotencyKey: string },
): Promise<Result<{ messageId: MessageId }, ReplyToMessageRefusal>> {
  const request = checkedSend(
    {
      selector: { kind: 'ship', shipId: reply.asked.senderShipId },
      payload: reply.payload,
      contentType: reply.contentType,
      idempotencyKey: reply.idempotencyKey,
      inReplyTo: reply.asked.id,
    },
    inTx.hasher,
  );
  if (!request.isOk) {
    return request;
  }
  const sent = await sendWithin(inTx, { caller: reply.crew, request: request.value });
  if (!sent.isOk) {
    return sent;
  }
  const done = await markDoneWithin(inTx, { crew: reply.crew, deliveryId: reply.delivery.id, reply: sent.value.messageId });
  return done.isOk ? ok(sent.value) : done;
}

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
      const found = await repliedToWithin(tx, { fleetId: crew.fleetId, crew, deliveryId: input.deliveryId });
      if (!found.isOk) {
        return found;
      }
      return replyWithin(
        { tx, clock: deps.clock, ids: deps.ids, hasher: deps.hasher },
        { crew, ...found.value, payload: input.payload, contentType: 'text/plain', idempotencyKey: input.idempotencyKey },
      );
    });
  };
}
