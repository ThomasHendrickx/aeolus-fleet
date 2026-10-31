import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { checkManage, keepingReachRefusal, type CheckManageTx, type NotReachable } from './check-reach.js';
import { setExpectations, setterOf, type ExpectationsChange, type SetExpectationsRefusal } from './expectations.js';
import type { ExpectationsRepository, ShipRepository } from './ports.js';

export interface SetExpectationsTx extends Omit<CheckManageTx, 'ships'> {
  ships: Pick<ShipRepository, 'find' | 'findForUpdate'>;
  expectations: ExpectationsRepository;
  events: EventLog;
}

export type SetExpectationsUseCaseRefusal = DomainError<'SHIP_NOT_FOUND'> | NotReachable | SetExpectationsRefusal;

export type SetExpectations = (caller: Caller, input: ExpectationsChange & { shipId: ShipId }) => Promise<Result<undefined, SetExpectationsUseCaseRefusal>>;

/**
 * Use case: an actor with fleet:manage sets expectations on a ship within
 * its manage reach (decision 0071, docs/design/monitoring 4.7): the owner's
 * ship by the built-in owner rule, any other ship by a manage rule that
 * reaches it (decision 0034). The scope is checked before this runs; a
 * refused reach keeps its record. It locks the ship, as a retire does, so
 * nothing is set on a ship a retire already passed by. ExpectationsSet in
 * the same unit of work.
 */
export function createSetExpectations(deps: { uow: UnitOfWork<SetExpectationsTx>; clock: Clock; ids: IdGenerator }): SetExpectations {
  return (caller, { shipId, ...change }) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<undefined, SetExpectationsUseCaseRefusal>> => {
      const { fleetId } = caller;
      const ship = await tx.ships.findForUpdate(fleetId, shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${shipId} does not exist`);
      }
      const at = deps.clock.now();
      const managed = await checkManage({ tx, ids: deps.ids }, { manager: caller, shipId: ship.id, at });
      if (!managed.isOk) {
        return managed;
      }
      const set = setExpectations(ship, { current: await tx.expectations.find(fleetId, ship.id), change, setter: setterOf(caller), at, actor: actorOf(caller) });
      if (!set.isOk) {
        return set;
      }
      const { kept, events } = set.value;
      if (events.length > 0) {
        if (kept === null) {
          await tx.expectations.remove(fleetId, ship.id);
        } else {
          await tx.expectations.save(kept);
        }
      }
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
