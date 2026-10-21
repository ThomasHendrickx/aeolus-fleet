import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { removeCrewRequest } from './crew-request.js';
import { checkManage, keepingReachRefusal, type CheckManageTx, type NotReachable } from './check-reach.js';
import type { CrewRequestRepository, ShipRepository } from './ports.js';

export interface RemoveCrewRequestTx extends Omit<CheckManageTx, 'ships'> {
  ships: Pick<ShipRepository, 'find' | 'findForUpdate'>;
  crewRequests: CrewRequestRepository;
  events: EventLog;
}

export type RemoveCrewRequest = (
  caller: Caller,
  input: { shipId: ShipId },
) => Promise<Result<undefined, DomainError<'SHIP_NOT_FOUND' | 'CREW_REQUEST_NOT_FOUND'> | NotReachable>>;

/**
 * Use case: a requester removes a ship's crew request. Its scope
 * (fleet:manage) is checked before this runs. In one unit of work, locking the
 * ship first: an unassigned request goes, with CrewRequestRemoved; an
 * assigned one is marked releasing, for its trierarch to release the ship and
 * confirm. A crew aboard without a trierarch stays aboard.
 */
export function createRemoveCrewRequest(deps: { uow: UnitOfWork<RemoveCrewRequestTx>; clock: Clock; ids: IdGenerator }): RemoveCrewRequest {
  return (caller, input) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<undefined, DomainError<'SHIP_NOT_FOUND' | 'CREW_REQUEST_NOT_FOUND'> | NotReachable>> => {
      const ship = await tx.ships.findForUpdate(caller.fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const managed = await checkManage({ tx, ids: deps.ids }, { manager: caller, shipId: ship.id, at: deps.clock.now() });
      if (!managed.isOk) {
        return managed;
      }
      const current = await tx.crewRequests.find(caller.fleetId, ship.id);
      const removed = removeCrewRequest({ ship, current }, { at: deps.clock.now(), actor: actorOf(caller) });
      if (!removed.isOk) {
        return removed;
      }
      const { request } = removed.value;
      if (request) {
        await tx.crewRequests.save(request);
      } else {
        await tx.crewRequests.remove(caller.fleetId, ship.id);
      }
      for (const event of removed.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
