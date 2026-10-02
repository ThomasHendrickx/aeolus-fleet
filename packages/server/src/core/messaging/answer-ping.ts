import type { DeliveryId, IdGenerator } from '@aeolus-fleet/common';

import type { LeaseRepository } from '../registry/public.js';
import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { answerPing, type AnswerPingRefusal } from './delivery.js';
import type { DeliveryRepository, MessageRepository } from './ports.js';

export interface AnswerPingTx {
  deliveries: Pick<DeliveryRepository, 'findForUpdate' | 'update'>;
  messages: Pick<MessageRepository, 'find'>;
  leases: Pick<LeaseRepository, 'markSeen'>;
  events: EventLog;
}

export type AnswerPingDeliveryRefusal = DomainError<'DELIVERY_NOT_FOUND'> | AnswerPingRefusal;

export type AnswerPing = (
  crew: Crew,
  input: { deliveryId: DeliveryId },
) => Promise<Result<undefined, AnswerPingDeliveryRefusal>>;

/**
 * Use case: the ship answers a ping (`pong`), proving its session's model
 * read it. Its scope (messages:receive) is checked before this runs. The ping
 * delivery, locked, is acknowledged with DeliveryAcknowledged saying pong
 * answered it, and the crew's lease is marked last seen at that moment: one
 * unit of work, so both are stored or neither. Answering again changes
 * nothing.
 */
export function createAnswerPing(deps: { uow: UnitOfWork<AnswerPingTx>; clock: Clock; ids: IdGenerator }): AnswerPing {
  return (crew, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, AnswerPingDeliveryRefusal>> => {
      const delivery = await tx.deliveries.findForUpdate(crew.fleetId, input.deliveryId);
      const message = delivery && (await tx.messages.find(crew.fleetId, delivery.messageId));
      if (!delivery || !message) {
        return refuse('DELIVERY_NOT_FOUND', `Delivery ${input.deliveryId} does not exist`);
      }
      const at = deps.clock.now();
      const answered = answerPing(delivery, { message, crew, at });
      if (!answered.isOk) {
        return answered;
      }

      const { delivery: changed, events } = answered.value;
      if (events.length === 0) {
        return ok(undefined);
      }
      await tx.deliveries.update(changed);
      await tx.leases.markSeen({ fleetId: crew.fleetId, leaseId: crew.leaseId, at });
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
