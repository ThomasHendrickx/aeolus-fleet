import type { ComputerSide, DeliveryId, DeliveryState, IdGenerator, MessageId, ShipId } from '@aeolus-fleet/common';

import { checkRead, type CheckReadTx, type NotReachable } from '../registry/public.js';
import type { ShipCaller } from './caller.js';
import type { Clock } from './clock.js';
import { computerSideOf, deliveryWayOf, type DeliveryWay, type WayLease } from './delivery-way.js';
import { refuse, type DomainError } from './errors.js';
import type { ShipHistory } from './history.js';
import { ok, type Result } from './result.js';
import type { UnitOfWork } from './unit-of-work.js';

/** The ship's side of the way (#756): which part serves it, its turn, and what waits for it. */
export interface ShipWay {
  /** The open lease's computer side (none: a pull lease) and its turn; null while no session crews the ship. */
  lease: { by: ComputerSide | null; turn: WayLease['turn'] } | null;
  /** How many deliveries wait for it. */
  waiting: number;
  /** The oldest one waiting, sent first, with its way; null when none waits. */
  oldest: {
    messageId: MessageId;
    sentAt: Date;
    contentType: string;
    delivery: { id: DeliveryId; state: DeliveryState; attempts: number; way: DeliveryWay };
  } | null;
}

export type ReadShipWay = (caller: ShipCaller, input: { shipId: ShipId }) => Promise<Result<ShipWay, DomainError<'SHIP_NOT_FOUND'> | NotReachable>>;

/**
 * Use case: one ship's side of the way: the trierarch or plugin watcher that
 * receives and hands over for its pushed lease, or none on a pull lease, the
 * turn its hooks reported, and its oldest delivery waiting, with its way, as
 * the clocks count it. A ship outside the caller's read reach is refused,
 * and the refusal recorded (decision 0034). The caller's scope (fleet:read) is
 * checked before this runs.
 */
export function createReadShipWay(deps: { history: ShipHistory; uow: UnitOfWork<CheckReadTx>; clock: Clock; ids: IdGenerator }): ReadShipWay {
  return async (caller, { shipId }) => {
    const found = await deps.history.shipWay(caller.fleetId, shipId);
    if (!found) {
      return refuse('SHIP_NOT_FOUND', `No ship ${shipId} in this fleet`);
    }
    // A refused read commits its record, then refuses.
    const checked = await deps.uow.run(async (tx) =>
      ok(await checkRead({ tx, ids: deps.ids }, { reader: caller, askedBy: caller.askedBy ?? null, shipId, at: deps.clock.now() })),
    );
    if (checked.isOk && !checked.value.isOk) {
      return checked.value;
    }
    const { lease, waiting } = found;
    const [oldestId] = waiting;
    const oldest = oldestId === undefined ? undefined : await deps.history.message(caller.fleetId, oldestId);
    return ok({
      lease: lease && { by: computerSideOf(lease), turn: lease.turn },
      waiting: waiting.length,
      oldest: oldest
        ? {
            messageId: oldest.id,
            sentAt: oldest.sentAt,
            contentType: oldest.contentType,
            delivery: {
              id: oldest.delivery.id,
              state: oldest.delivery.state,
              attempts: oldest.delivery.attempts,
              way: deliveryWayOf({ state: oldest.delivery.state, history: oldest.history, lease: oldest.lease, overdue: oldest.overdue, crew: oldest.crew }),
            },
          }
        : null,
    });
  };
}
