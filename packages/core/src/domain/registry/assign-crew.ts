import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { assignCrew, type AssignCrewRefusal } from './crew-request.js';
import type { CrewRequestRepository, LeaseRepository, ShipRepository } from './ports.js';

export interface AssignCrewTx {
  ships: Pick<ShipRepository, 'findForUpdate' | 'find'>;
  leases: Pick<LeaseRepository, 'findOpenForShare'>;
  crewRequests: CrewRequestRepository;
  events: EventLog;
}

export type AssignCrew = (
  caller: Caller,
  input: { shipId: ShipId; trierarchShipId: ShipId },
) => Promise<Result<undefined, DomainError<'SHIP_NOT_FOUND'> | AssignCrewRefusal>>;

/**
 * Use case: a ship with crew:assign (the trierarch plugin) assigns a ship's
 * crew request to a trierarch. Its scope is checked before this runs. In one
 * unit of work, locking the ship first, so of two claims on one request the
 * second finds it assigned (optimistic claim); its lease is held as a release
 * holds it, so a claim and a crew coming aboard never cross.
 */
export function createAssignCrew(deps: { uow: UnitOfWork<AssignCrewTx>; clock: Clock; ids: IdGenerator }): AssignCrew {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, DomainError<'SHIP_NOT_FOUND'> | AssignCrewRefusal>> => {
      const { fleetId } = caller;
      const ship = await tx.ships.findForUpdate(fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const assigned = assignCrew(
        {
          ship,
          current: await tx.crewRequests.find(fleetId, ship.id),
          isCrewed: (await tx.leases.findOpenForShare(fleetId, ship.id)) !== undefined,
          assignee: await tx.ships.find(fleetId, input.trierarchShipId),
        },
        { at: deps.clock.now(), actor: shipActor(caller.shipId) },
      );
      if (!assigned.isOk) {
        return assigned;
      }
      await tx.crewRequests.save(assigned.value.request);
      for (const event of assigned.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
