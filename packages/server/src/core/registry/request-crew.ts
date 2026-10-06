import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { requestCrew, type RequestCrewRefusal } from './crew-request.js';
import type { CrewRequestRepository, ShipRepository } from './ports.js';
import type { JsonObject } from './report-details.js';

export interface RequestCrewTx {
  ships: Pick<ShipRepository, 'findForUpdate'>;
  crewRequests: CrewRequestRepository;
  events: EventLog;
}

export type RequestCrew = (
  caller: Caller,
  input: { shipId: ShipId; settings: JsonObject },
) => Promise<Result<{ settingsVersion: number }, DomainError<'SHIP_NOT_FOUND'> | RequestCrewRefusal>>;

/**
 * Use case: a requester asks that a ship be kept crewed, with these settings,
 * replacing any request the ship holds. Its scope (fleet:manage) is checked
 * before this runs. In one unit of work, locking the ship first, as a retire
 * does, so a retire and a request never cross: the request and CrewRequested.
 */
export function createRequestCrew(deps: { uow: UnitOfWork<RequestCrewTx>; clock: Clock; ids: IdGenerator }): RequestCrew {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<{ settingsVersion: number }, DomainError<'SHIP_NOT_FOUND'> | RequestCrewRefusal>> => {
      const ship = await tx.ships.findForUpdate(caller.fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const current = await tx.crewRequests.find(caller.fleetId, ship.id);
      const requested = requestCrew({ ship, current }, { settings: input.settings, at: deps.clock.now(), actor: shipActor(caller.shipId) });
      if (!requested.isOk) {
        return requested;
      }
      await tx.crewRequests.save(requested.value.request);
      for (const event of requested.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ settingsVersion: requested.value.request.settingsVersion });
    });
}
