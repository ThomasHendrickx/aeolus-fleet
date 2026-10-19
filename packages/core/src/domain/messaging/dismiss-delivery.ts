import type { DeliveryId, IdGenerator } from '@aeolus-fleet/common';

import { readsMessage, type ReadReachOf } from '../registry/public.js';
import type { ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { dismissDelivery, type DismissRefusal } from './delivery.js';
import type { DeliveryRepository, MessageRepository } from './ports.js';

export interface DismissDeliveryTx {
  deliveries: Pick<DeliveryRepository, 'findForUpdate' | 'update'>;
  messages: Pick<MessageRepository, 'find'>;
  events: EventLog;
}

export type DismissDeliveryRefusal = DomainError<'DELIVERY_NOT_FOUND'> | DismissRefusal;

export type DismissDelivery = (
  caller: ShipCaller,
  input: { deliveryId: DeliveryId },
) => Promise<Result<undefined, DismissDeliveryRefusal>>;

/**
 * Use case: the operator dismisses an undeliverable or not handled delivery from Needs
 * attention. Its scope (messages:resend) is checked before this runs. A
 * delivery of a message outside the caller's read reach is answered as none,
 * so its existence does not show (decision 0046). The delivery, locked,
 * becomes dismissed with DeliveryDismissed in one unit of work, so a resend
 * of the same delivery waits and then finds it dismissed.
 */
export function createDismissDelivery(deps: {
  uow: UnitOfWork<DismissDeliveryTx>;
  clock: Clock;
  ids: IdGenerator;
  readReach: ReadReachOf;
}): DismissDelivery {
  return async (caller, input) => {
    const reach = await deps.readReach(caller);
    return deps.uow.run(async (tx): Promise<Result<undefined, DismissDeliveryRefusal>> => {
      const delivery = await tx.deliveries.findForUpdate(caller.fleetId, input.deliveryId);
      const message = delivery && (await tx.messages.find(caller.fleetId, delivery.messageId));
      if (!delivery || !message || !readsMessage(reach, { senderId: message.senderShipId, recipient: message.selector, claimedBy: delivery.claimedByShipId })) {
        return refuse('DELIVERY_NOT_FOUND', `Delivery ${input.deliveryId} does not exist`);
      }
      const dismissed = dismissDelivery(delivery, { by: caller.shipId, at: deps.clock.now() });
      if (!dismissed.isOk) {
        return dismissed;
      }

      const { delivery: changed, events } = dismissed.value;
      await tx.deliveries.update(changed);
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
  };
}
