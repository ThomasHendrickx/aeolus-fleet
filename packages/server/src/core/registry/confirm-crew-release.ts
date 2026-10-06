import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { confirmCrewRelease } from './crew-request.js';
import type { CrewRequestRepository, ShipRepository } from './ports.js';

export interface ConfirmCrewReleaseTx {
  ships: Pick<ShipRepository, 'findForUpdate'>;
  crewRequests: CrewRequestRepository;
  events: EventLog;
}

export type ConfirmCrewReleaseRefusal = DomainError<
  'SHIP_NOT_FOUND' | 'CREW_REQUEST_NOT_FOUND' | 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER' | 'CREW_REQUEST_NOT_RELEASING'
>;

export type ConfirmCrewRelease = (caller: Caller, input: { shipId: ShipId }) => Promise<Result<undefined, ConfirmCrewReleaseRefusal>>;

/**
 * Use case: the trierarch a releasing crew request is assigned to confirms it
 * stopped the session, ended the lease and cleaned its workspace. Its scope
 * (crew:run) is checked before this runs. In one unit of work, locking the
 * ship first: the request goes, with CrewRequestRemoved.
 */
export function createConfirmCrewRelease(deps: { uow: UnitOfWork<ConfirmCrewReleaseTx>; clock: Clock; ids: IdGenerator }): ConfirmCrewRelease {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, ConfirmCrewReleaseRefusal>> => {
      const ship = await tx.ships.findForUpdate(caller.fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const confirmed = confirmCrewRelease(
        { ship, current: await tx.crewRequests.find(caller.fleetId, ship.id), trierarchShipId: caller.shipId },
        { at: deps.clock.now(), actor: shipActor(caller.shipId) },
      );
      if (!confirmed.isOk) {
        return confirmed;
      }
      await tx.crewRequests.remove(caller.fleetId, ship.id);
      for (const event of confirmed.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
