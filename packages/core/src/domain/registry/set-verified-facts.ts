import type { IdGenerator, ShipId, VerifiedFact } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { checkManage, keepingReachRefusal, type CheckManageTx, type NotReachable } from './check-reach.js';
import type { ShipRepository, VerifiedFactsRepository } from './ports.js';
import { setVerifiedFacts, writerOf, type SetVerifiedFactsRefusal } from './verified-facts.js';

export interface SetVerifiedFactsTx extends Omit<CheckManageTx, 'ships'> {
  ships: Pick<ShipRepository, 'find' | 'findForUpdate'>;
  verifiedFacts: VerifiedFactsRepository;
  events: EventLog;
}

export type SetVerifiedFactsUseCaseRefusal = DomainError<'SHIP_NOT_FOUND'> | NotReachable | SetVerifiedFactsRefusal;

export type SetVerifiedFacts = (caller: Caller, input: { shipId: ShipId; facts: readonly VerifiedFact[] }) => Promise<Result<undefined, SetVerifiedFactsUseCaseRefusal>>;

/**
 * Use case: an actor holding fleet:verify sets its verified facts about a
 * ship within its manage reach (decision 0059), whole, their shape checked
 * at the edge; none withdraws them. Another writer's facts stay as they are.
 * The scope is checked before this runs; a refused reach keeps its record.
 * It locks the ship, as a retire does, so no fact is written about a ship a
 * retire already passed by, and two sets by one writer take turns.
 * VerifiedFactsSet in the same unit of work.
 */
export function createSetVerifiedFacts(deps: { uow: UnitOfWork<SetVerifiedFactsTx>; clock: Clock; ids: IdGenerator }): SetVerifiedFacts {
  return (caller, input) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<undefined, SetVerifiedFactsUseCaseRefusal>> => {
      const { fleetId } = caller;
      const ship = await tx.ships.findForUpdate(fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const at = deps.clock.now();
      const managed = await checkManage({ tx, ids: deps.ids }, { manager: caller, shipId: ship.id, at });
      if (!managed.isOk) {
        return managed;
      }
      const writer = writerOf(caller);
      const current = await tx.verifiedFacts.find(fleetId, { shipId: ship.id, writer });
      const set = setVerifiedFacts(ship, { current, writer, facts: input.facts, at, actor: actorOf(caller) });
      if (!set.isOk) {
        return set;
      }
      const { written, events } = set.value;
      if (events.length > 0) {
        if (written === null) {
          await tx.verifiedFacts.remove(fleetId, { shipId: ship.id, writer });
        } else {
          await tx.verifiedFacts.save(written);
        }
      }
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
