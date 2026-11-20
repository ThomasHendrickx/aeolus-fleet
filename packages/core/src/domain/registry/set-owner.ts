import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { checkManage, keepingReachRefusal, type CheckManageTx, type NotReachable } from './check-reach.js';
import type { ShipRepository } from './ports.js';
import { validateOwnership } from './ownership.js';
import { changeOwner, type ChangeOwnerRefusal } from './ship.js';

export interface SetOwnerTx extends Omit<CheckManageTx, 'ships'> {
  ships: Pick<ShipRepository, 'find' | 'findForUpdate' | 'setOwner' | 'lockOwnership'>;
  events: EventLog;
}

export type SetOwnerRefusal = DomainError<'SHIP_NOT_FOUND'> | NotReachable | ChangeOwnerRefusal;

export type SetOwner = (caller: Caller, input: { shipId: ShipId; ownerShipId: ShipId }) => Promise<Result<undefined, SetOwnerRefusal>>;

/** Changes a direct owner under the fleet ownership lock, with its event in the same transaction. */
export function createSetOwner(deps: { uow: UnitOfWork<SetOwnerTx>; clock: Clock; ids: IdGenerator }): SetOwner {
  return (caller, input) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<undefined, SetOwnerRefusal>> => {
      const { fleetId } = caller;
      await tx.ships.lockOwnership(fleetId);
      const owner = await tx.ships.findForUpdate(fleetId, input.ownerShipId);
      const ship = await tx.ships.findForUpdate(fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const at = deps.clock.now();
      const managed = await checkManage({ tx, ids: deps.ids }, { manager: caller, shipId: ship.id, at });
      if (!managed.isOk) {
        return managed;
      }
      const changed = changeOwner(ship, { owner, why: 'set', at, actor: actorOf(caller) });
      if (!changed.isOk) {
        return changed;
      }
      const { ship: owned, events } = changed.value;
      if (events.length === 0) {
        return ok(undefined);
      }
      const valid = await validateOwnership(tx.ships, { fleetId, shipId: ship.id, ownerShipId: input.ownerShipId });
      if (!valid.isOk) {
        return valid;
      }
      if (owned.owner !== null && owned.owner !== ship.owner) {
        await tx.ships.setOwner({ fleetId, shipId: ship.id, ownerShipId: owned.owner });
      }
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
