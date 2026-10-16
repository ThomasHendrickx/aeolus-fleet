import type { DeliveryId, IdGenerator } from '@aeolus-fleet/common';

import { holdLease, type HoldLeaseTx, type LeaseEnded } from '../registry/public.js';
import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import { endTurn, type TurnEnd, type TurnEndRefusal } from './delivery.js';
import type { DeliveryRepository } from './ports.js';

export interface ReportTurnEndTx extends HoldLeaseTx {
  deliveries: Pick<DeliveryRepository, 'findForUpdate' | 'update'>;
  events: EventLog;
}

export type ReportTurnEndRefusal = DomainError<'DELIVERY_NOT_FOUND'> | TurnEndRefusal | LeaseEnded;

/**
 * The unit of work of handled and not handled, which differ only in how the
 * turn ended: hold the crew's lease, so a release waits for it and an ended
 * lease is refused; lock the delivery, so two reports take turns; apply the
 * report and write its event.
 */
export async function reportTurnEnd(
  deps: { tx: ReportTurnEndTx; clock: Clock; ids: IdGenerator },
  report: { crew: Crew; deliveryId: DeliveryId; end: TurnEnd; reason?: string },
): Promise<Result<undefined, ReportTurnEndRefusal>> {
  const { tx } = deps;
  const { crew, deliveryId, ...ending } = report;
  const held = await holdLease(tx, crew);
  if (!held.isOk) {
    return held;
  }
  const delivery = await tx.deliveries.findForUpdate(crew.fleetId, deliveryId);
  if (!delivery) {
    return refuse('DELIVERY_NOT_FOUND', `Delivery ${deliveryId} does not exist`);
  }
  const ended = endTurn(delivery, { crew, ...ending, at: deps.clock.now() });
  if (!ended.isOk) {
    return ended;
  }

  const { delivery: changed, events } = ended.value;
  if (events.length > 0) {
    await tx.deliveries.update(changed);
  }
  for (const event of events) {
    await recordEvent({ events: tx.events, ids: deps.ids }, event);
  }
  return ok(undefined);
}
