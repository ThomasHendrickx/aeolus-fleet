import type { DeliveryId } from '@aeolus-fleet/common';

import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { isInInboxOf } from './delivery.js';
import type { DeliveryRepository } from './ports.js';

export interface MarkReadTx {
  deliveries: Pick<DeliveryRepository, 'findForUpdate' | 'markRead' | 'markUnread'>;
}

export type MarkReadRefusal = DomainError<'DELIVERY_NOT_FOUND' | 'NOT_THE_OPERATOR_SHIP'>;

export type MarkRead = (
  crew: Crew,
  input: { deliveryId: DeliveryId; isRead: boolean },
) => Promise<Result<undefined, MarkReadRefusal>>;

/**
 * Use case: argo opens a message to it, which marks it read, or marks it
 * unread again (docs/blueprint.md, "Inbox"). Its scope (messages:receive) is
 * checked before this runs. Read is not done: the delivery's state stays as
 * it is, and no event is written, since read is how the operator sees a
 * message, not a step of its delivery. Opening it again keeps when it was
 * first read. Done messages are read or unread too.
 */
export function createMarkRead(deps: { uow: UnitOfWork<MarkReadTx>; clock: Clock }): MarkRead {
  return async (crew, input) => {
    if (crew.kind !== 'operator') {
      return refuse('NOT_THE_OPERATOR_SHIP', 'Only argo marks a message read in the operator inbox');
    }
    return deps.uow.run(async (tx): Promise<Result<undefined, MarkReadRefusal>> => {
      const { fleetId } = crew;
      const { deliveryId } = input;
      const delivery = await tx.deliveries.findForUpdate(fleetId, deliveryId);
      if (!isInInboxOf(delivery, crew.shipId)) {
        return refuse('DELIVERY_NOT_FOUND', `Delivery ${deliveryId} is not in your inbox`);
      }
      if (input.isRead) {
        await tx.deliveries.markRead({ fleetId, deliveryId, at: deps.clock.now() });
      } else {
        await tx.deliveries.markUnread({ fleetId, deliveryId });
      }
      return ok(undefined);
    });
  };
}
