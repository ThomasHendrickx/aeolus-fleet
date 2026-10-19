import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { ShipRepository } from './ports.js';
import { changeOwner, type ChangeOwnerRefusal } from './ship.js';

export interface SetOwnerTx {
  ships: Pick<ShipRepository, 'findForUpdate' | 'setOwner'>;
  events: EventLog;
}

export type SetOwnerRefusal = DomainError<'NOT_THE_OPERATOR_SHIP' | 'SHIP_NOT_FOUND'> | ChangeOwnerRefusal;

export type SetOwner = (caller: ShipCaller, input: { shipId: ShipId; ownerShipId: ShipId }) => Promise<Result<undefined, SetOwnerRefusal>>;

/**
 * Use case: argo, and only argo, gives a ship a new owner, an active person's
 * ship or argo (decision 0045), with OwnerChanged in the same unit of work.
 * It locks the owner first, then the ship, as a retire of the owner locks it
 * before the ships it owns, so the two never wait on each other: the new
 * owner is never one a retire already passed by.
 */
export function createSetOwner(deps: { uow: UnitOfWork<SetOwnerTx>; clock: Clock; ids: IdGenerator }): SetOwner {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, SetOwnerRefusal>> => {
      if (caller.kind !== 'operator') {
        return refuse('NOT_THE_OPERATOR_SHIP', "Only argo changes a ship's owner");
      }
      const { fleetId } = caller;
      const owner = await tx.ships.findForUpdate(fleetId, input.ownerShipId);
      const ship = await tx.ships.findForUpdate(fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const changed = changeOwner(ship, { owner, why: 'setByArgo', at: deps.clock.now(), actor: shipActor(caller.shipId) });
      if (!changed.isOk) {
        return changed;
      }
      const { ship: owned, events } = changed.value;
      if (owned.owner !== null && owned.owner !== ship.owner) {
        await tx.ships.setOwner({ fleetId, shipId: ship.id, ownerShipId: owned.owner });
      }
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
