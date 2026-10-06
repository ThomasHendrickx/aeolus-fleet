import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { explainCrewRequest, type ExplainCrewRequestRefusal } from './crew-request.js';
import type { CrewRequestRepository, ShipRepository } from './ports.js';

export interface ExplainCrewRequestTx {
  ships: Pick<ShipRepository, 'findForUpdate'>;
  crewRequests: CrewRequestRepository;
  events: EventLog;
}

export type ExplainCrewRequest = (
  caller: Caller,
  input: { shipId: ShipId; reason: string | null },
) => Promise<Result<undefined, DomainError<'SHIP_NOT_FOUND'> | ExplainCrewRequestRefusal>>;

/**
 * Use case: the assigner (crew:assign, the trierarch plugin) writes why no trierarch
 * can take a ship's unassigned crew request, shown in the operator's
 * needs-crew to-do. Its scope is checked before this runs. In one unit of
 * work, locking the ship first: the reason and, when it changed,
 * CrewRequestExplained.
 */
export function createExplainCrewRequest(deps: { uow: UnitOfWork<ExplainCrewRequestTx>; clock: Clock; ids: IdGenerator }): ExplainCrewRequest {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, DomainError<'SHIP_NOT_FOUND'> | ExplainCrewRequestRefusal>> => {
      const ship = await tx.ships.findForUpdate(caller.fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const explained = explainCrewRequest(
        { ship, current: await tx.crewRequests.find(caller.fleetId, ship.id) },
        { reason: input.reason, at: deps.clock.now(), actor: shipActor(caller.shipId) },
      );
      if (!explained.isOk) {
        return explained;
      }
      if (explained.value.events.length > 0) {
        await tx.crewRequests.save(explained.value.request);
      }
      for (const event of explained.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
