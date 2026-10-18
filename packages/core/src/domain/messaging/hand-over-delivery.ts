import type { DeliveryId, IdGenerator } from '@aeolus-fleet/common';

import { holdLease, type HoldLeaseTx, type LeaseEnded } from '../registry/public.js';
import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { handOverDelivery, type HandedState, type HandOverRefusal } from './delivery.js';
import type { DeliveryRepository } from './ports.js';

export interface HandOverDeliveryTx extends HoldLeaseTx {
  deliveries: Pick<DeliveryRepository, 'findForUpdate' | 'update'>;
  events: EventLog;
}

export type HandOverDeliveryRefusal = DomainError<'DELIVERY_NOT_FOUND'> | HandOverRefusal | LeaseEnded;

export type HandOverDelivery = (
  crew: Crew,
  input: { deliveryId: DeliveryId; handOverNumber: number; isOnceMore?: boolean; channel?: string },
) => Promise<Result<{ state: HandedState }, HandOverDeliveryRefusal>>;

/**
 * Use case: the crew's computer side reports it handed a delivery to the
 * agent (`handed`, decision 0040), with its hand-over number. Its scope
 * (messages:receive) is checked before this runs. In one unit of work it
 * holds the crew's lease, so a release waits for it, locks the delivery and
 * applies the hand-over: a new number counts one attempt and writes
 * DeliveryHanded, the fifth is undeliverable instead, and a repeated number
 * changes nothing. Handed once more keeps a confirmed message acknowledged
 * and writes DeliveryHanded marked once more, only once. The lock makes a hand-over, an ack and a receive of the
 * same delivery take turns. It answers where the delivery stands.
 */
export function createHandOverDelivery(deps: {
  uow: UnitOfWork<HandOverDeliveryTx>;
  clock: Clock;
  ids: IdGenerator;
}): HandOverDelivery {
  return (crew, input) =>
    deps.uow.run(async (tx): Promise<Result<{ state: HandedState }, HandOverDeliveryRefusal>> => {
      const held = await holdLease(tx, crew);
      if (!held.isOk) {
        return held;
      }
      const delivery = await tx.deliveries.findForUpdate(crew.fleetId, input.deliveryId);
      if (!delivery) {
        return refuse('DELIVERY_NOT_FOUND', `Delivery ${input.deliveryId} does not exist`);
      }
      const handedOver = handOverDelivery(delivery, {
        crew,
        handOverNumber: input.handOverNumber,
        isOnceMore: input.isOnceMore === true,
        ...(input.channel === undefined ? {} : { channel: input.channel }),
        at: deps.clock.now(),
      });
      if (!handedOver.isOk) {
        return handedOver;
      }

      const { state, delivery: changed, events } = handedOver.value;
      if (events.length > 0) {
        await tx.deliveries.update(changed);
      }
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ state });
    });
}
