import type { DeliveryId, DeliveryState } from '@aeolus-fleet/common';

import { holdLease, type HoldLeaseTx, type LeaseEnded } from '../registry/public.js';
import type { Crew } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { rereadDelivery, type RereadRefusal } from './delivery.js';
import type { DeliveryRepository, MessageRepository } from './ports.js';
import { receivedDeliveryOf, type ReceivedDelivery } from './receive-deliveries.js';

export interface ReadDeliveryTx extends HoldLeaseTx {
  deliveries: Pick<DeliveryRepository, 'find'>;
  messages: Pick<MessageRepository, 'find'>;
}

/** A delivery read again: as a receive hands one, with its state. */
export interface ReadDeliveryOutput extends ReceivedDelivery {
  state: DeliveryState;
}

export type ReadDeliveryRefusal = RereadRefusal | DomainError<'SHIP_NOT_FOUND'> | LeaseEnded;

export type ReadDelivery = (crew: Crew, input: { deliveryId: DeliveryId }) => Promise<Result<ReadDeliveryOutput, ReadDeliveryRefusal>>;

/**
 * Use case: a crew reads one of its deliveries again, whole (`delivery`),
 * while its lease holds it acknowledged and not yet handled, such as a
 * message a person opened in one client and reads again from another. Its
 * scope (messages:receive) is checked before this runs. It holds the crew's
 * lease, so an ended lease is refused, and reads without a lock: it hands,
 * counts and records nothing, so the delivery's state, attempts and clocks
 * stay as they were (decision 0040).
 */
export function createReadDelivery(deps: { uow: UnitOfWork<ReadDeliveryTx> }): ReadDelivery {
  return (crew, { deliveryId }) =>
    deps.uow.run(async (tx): Promise<Result<ReadDeliveryOutput, ReadDeliveryRefusal>> => {
      const held = await holdLease(tx, crew);
      if (!held.isOk) {
        return held;
      }
      const reread = rereadDelivery({ deliveryId, delivery: await tx.deliveries.find(crew.fleetId, deliveryId) }, crew);
      if (!reread.isOk) {
        return reread;
      }
      const delivery = reread.value;
      const message = await tx.messages.find(crew.fleetId, delivery.messageId);
      if (!message) {
        // Never happens: the foreign key keeps every delivery's message in its fleet.
        return refuse('DELIVERY_NOT_FOUND', `Delivery ${deliveryId} does not exist`);
      }
      const received = await receivedDeliveryOf(tx, { delivery, message });
      if (!received.isOk) {
        return received;
      }
      return ok({ ...received.value, state: delivery.state });
    });
}
