import type { DeliveryId, IdGenerator, MessageId } from '@aeolus-fleet/common';

import { holdLease, type HoldLeaseTx, type LeaseEnded } from '../registry/public.js';
import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { markDone, type MarkDoneRefusal } from './delivery.js';
import type { DeliveryRepository } from './ports.js';

export interface MarkDoneTx extends HoldLeaseTx {
  deliveries: Pick<DeliveryRepository, 'findForUpdate' | 'update'>;
  events: EventLog;
}

export type MarkDoneUseCaseRefusal =
  | DomainError<'DELIVERY_NOT_FOUND' | 'NOT_THE_OPERATOR_SHIP'>
  | LeaseEnded
  | MarkDoneRefusal;

export type MarkDone = (crew: Crew, input: { deliveryId: DeliveryId }) => Promise<Result<undefined, MarkDoneUseCaseRefusal>>;

/**
 * Marks a delivery to argo done inside the caller's unit of work, under the
 * console session's lease, held until the unit of work ends: a sign-in
 * elsewhere ending it waits, then returns nothing this marked. `reply` names
 * the reply that made it done. Only argo: an agent acknowledges what it
 * receives.
 */
export async function markDoneWithin(
  deps: { tx: MarkDoneTx; clock: Clock; ids: IdGenerator },
  done: { crew: Crew; deliveryId: DeliveryId; reply?: MessageId },
): Promise<Result<undefined, MarkDoneUseCaseRefusal>> {
  const { tx, clock, ids } = deps;
  const { crew, deliveryId, reply } = done;
  if (crew.kind !== 'operator') {
    return refuse('NOT_THE_OPERATOR_SHIP', 'Only argo marks a message done; a ship acknowledges what it receives');
  }
  const held = await holdLease(tx, crew);
  if (!held.isOk) {
    return held;
  }
  const delivery = await tx.deliveries.findForUpdate(crew.fleetId, deliveryId);
  if (!delivery) {
    return refuse('DELIVERY_NOT_FOUND', `Delivery ${deliveryId} does not exist`);
  }
  const marked = markDone(delivery, { crew, at: clock.now(), reply });
  if (!marked.isOk) {
    return marked;
  }

  const { delivery: changed, events } = marked.value;
  if (events.length > 0) {
    await tx.deliveries.update(changed);
  }
  for (const event of events) {
    await recordEvent({ events: tx.events, ids }, event);
  }
  return ok(undefined);
}

/**
 * Use case: argo marks a message to it done from the operator inbox, without
 * a reply (docs/blueprint.md, "Inbox"). Its scope (messages:receive) is
 * checked before this runs. One unit of work: the claim, the acknowledgement
 * and their events.
 */
export function createMarkDone(deps: { uow: UnitOfWork<MarkDoneTx>; clock: Clock; ids: IdGenerator }): MarkDone {
  return (crew, input) =>
    deps.uow.run((tx) => markDoneWithin({ tx, clock: deps.clock, ids: deps.ids }, { crew, deliveryId: input.deliveryId }));
}
