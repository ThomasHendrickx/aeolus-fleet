import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { removeCrewRequest } from './crew-request.js';
import type { CrewRequestRepository, ShipRepository } from './ports.js';

export interface RemoveCrewRequestTx {
  ships: Pick<ShipRepository, 'findForUpdate'>;
  crewRequests: CrewRequestRepository;
  events: EventLog;
}

export type RemoveCrewRequest = (
  caller: Caller,
  input: { shipId: ShipId },
) => Promise<Result<undefined, DomainError<'SHIP_NOT_FOUND' | 'CREW_REQUEST_NOT_FOUND'>>>;

/**
 * Use case: a requester removes a ship's crew request. Its scope
 * (fleet:manage) is checked before this runs. In one unit of work, locking the
 * ship first: the request goes, with CrewRequestRemoved. The ship's crew, if
 * any, stays aboard.
 */
export function createRemoveCrewRequest(deps: { uow: UnitOfWork<RemoveCrewRequestTx>; clock: Clock; ids: IdGenerator }): RemoveCrewRequest {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, DomainError<'SHIP_NOT_FOUND' | 'CREW_REQUEST_NOT_FOUND'>>> => {
      const ship = await tx.ships.findForUpdate(caller.fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const current = await tx.crewRequests.find(caller.fleetId, ship.id);
      const removed = removeCrewRequest({ ship, current }, { at: deps.clock.now(), actor: shipActor(caller.shipId) });
      if (!removed.isOk) {
        return removed;
      }
      await tx.crewRequests.remove(caller.fleetId, ship.id);
      for (const event of removed.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
