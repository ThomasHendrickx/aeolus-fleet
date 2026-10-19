import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { checkManage, keepingReachRefusal, type CheckManageTx, type NotReachable } from './check-reach.js';
import type { ShipRepository } from './ports.js';
import { renameShip, type RenameRefusal } from './ship.js';

export interface RenameShipTx extends Omit<CheckManageTx, 'ships'> {
  ships: Pick<ShipRepository, 'find' | 'findForUpdate' | 'lockName' | 'findActiveByName' | 'rename'>;
  events: EventLog;
}

export type RenameShipRefusal = DomainError<'SHIP_NOT_FOUND'> | NotReachable | RenameRefusal;

export type RenameShip = (
  caller: Caller,
  input: { shipId: ShipId; name: string },
) => Promise<Result<undefined, RenameShipRefusal>>;

/**
 * Use case: the caller renames a ship it manages: its scope (fleet:manage)
 * is checked before this runs, and manage reach on the ship here (decision
 * 0034), a refusal storing only its record. In one unit of work, locking the ship, then the new name
 * (as a commission does), so two renames or a commission to one name never
 * both find it free: the new name and ShipRenamed. Its id, history and
 * session stay; a sender addressing the old name no longer reaches it.
 */
export function createRenameShip(deps: { uow: UnitOfWork<RenameShipTx>; clock: Clock; ids: IdGenerator }): RenameShip {
  return (caller, input) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<undefined, RenameShipRefusal>> => {
      const { fleetId } = caller;
      const ship = await tx.ships.findForUpdate(fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const managed = await checkManage({ tx, ids: deps.ids }, { manager: caller, shipId: ship.id, at: deps.clock.now() });
      if (!managed.isOk) {
        return managed;
      }
      await tx.ships.lockName(fleetId, input.name);
      const renamed = renameShip(ship, {
        name: input.name,
        at: deps.clock.now(),
        actor: actorOf(caller),
        activeShipNamed: await tx.ships.findActiveByName(fleetId, input.name),
      });
      if (!renamed.isOk) {
        return renamed;
      }

      const { ship: changed, events } = renamed.value;
      if (changed.name !== ship.name) {
        await tx.ships.rename({ fleetId, shipId: ship.id, name: changed.name });
      }
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
