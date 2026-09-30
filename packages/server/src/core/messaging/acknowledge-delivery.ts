import type { DeliveryId, IdGenerator } from '@aeolus-fleet/common';

import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { acknowledgeDelivery, type AcknowledgeRefusal } from './delivery.js';
import type { DeliveryRepository } from './ports.js';

export interface AcknowledgeDeliveryTx {
  deliveries: Pick<DeliveryRepository, 'findForUpdate' | 'update'>;
  events: EventLog;
}

export type AcknowledgeDeliveryRefusal = DomainError<'DELIVERY_NOT_FOUND'> | AcknowledgeRefusal;

export type AcknowledgeDelivery = (
  crew: Crew,
  input: { deliveryId: DeliveryId },
) => Promise<Result<undefined, AcknowledgeDeliveryRefusal>>;

/**
 * Use case: the ship acknowledges a delivery it received (`ack`), as soon as
 * it receives it (ADR 0001). Its scope (messages:receive) is checked before
 * this runs. The delivery, locked, moves to acknowledged with
 * DeliveryAcknowledged in one unit of work, only while it is in flight with
 * the calling ship; a second ack by that ship is OK and changes nothing. The
 * lock makes an ack and a receive of the same delivery take turns.
 */
export function createAcknowledgeDelivery(deps: {
  uow: UnitOfWork<AcknowledgeDeliveryTx>;
  clock: Clock;
  ids: IdGenerator;
}): AcknowledgeDelivery {
  return (crew, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, AcknowledgeDeliveryRefusal>> => {
      const delivery = await tx.deliveries.findForUpdate(crew.fleetId, input.deliveryId);
      if (!delivery) {
        return refuse('DELIVERY_NOT_FOUND', `Delivery ${input.deliveryId} does not exist`);
      }
      const acknowledged = acknowledgeDelivery(delivery, { crew, at: deps.clock.now() });
      if (!acknowledged.isOk) {
        return acknowledged;
      }

      const { delivery: changed, events } = acknowledged.value;
      await tx.deliveries.update(changed);
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
