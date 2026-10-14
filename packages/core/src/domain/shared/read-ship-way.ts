import type { ComputerSide, DeliveryId, DeliveryState, MessageId, ShipId } from '@aeolus-fleet/common';

import type { Caller } from './caller.js';
import { computerSideOf, deliveryWayOf, type DeliveryWay, type WayLease } from './delivery-way.js';
import { refuse, type DomainError } from './errors.js';
import type { ShipHistory } from './history.js';
import { ok, type Result } from './result.js';

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

export type ReadShipWay = (caller: Caller, input: { shipId: ShipId }) => Promise<Result<ShipWay, DomainError<'SHIP_NOT_FOUND'>>>;

/**
 * Use case: one ship's side of the way: the trierarch or plugin watcher that
 * receives and hands over for its pushed lease, or none on a pull lease, the
 * turn its hooks reported, and its oldest delivery waiting, with its way, as
 * the clocks count it. The caller's scope (fleet:read) is checked before this
 * runs.
 */
export function createReadShipWay(deps: { history: ShipHistory }): ReadShipWay {
  return async (caller, { shipId }) => {
    const found = await deps.history.shipWay(caller.fleetId, shipId);
    if (!found) {
      return refuse('SHIP_NOT_FOUND', `No ship ${shipId} in this fleet`);
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
