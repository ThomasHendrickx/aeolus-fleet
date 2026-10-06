import type { CrewStatus, IdGenerator, ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { reportCrewStatus } from './crew-request.js';
import type { CrewRequestRepository, ShipRepository } from './ports.js';

export interface ReportCrewStatusTx {
  ships: Pick<ShipRepository, 'findForUpdate'>;
  crewRequests: CrewRequestRepository;
  events: EventLog;
}

export type ReportCrewStatusRefusal = DomainError<
  'SHIP_NOT_FOUND' | 'CREW_REQUEST_NOT_FOUND' | 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER' | 'CREW_REQUEST_RELEASING'
>;

export type ReportCrewStatus = (caller: Caller, input: { shipId: ShipId; status: CrewStatus }) => Promise<Result<undefined, ReportCrewStatusRefusal>>;

/**
 * Use case: the trierarch a ship's crew request is assigned to writes how its
 * crew stands. Its scope (crew:run) is checked before this runs. In one unit
 * of work, locking the ship first: the status and, when it changed,
 * CrewStatusChanged.
 */
export function createReportCrewStatus(deps: { uow: UnitOfWork<ReportCrewStatusTx>; clock: Clock; ids: IdGenerator }): ReportCrewStatus {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, ReportCrewStatusRefusal>> => {
      const ship = await tx.ships.findForUpdate(caller.fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const reported = reportCrewStatus(
        { ship, current: await tx.crewRequests.find(caller.fleetId, ship.id), trierarchShipId: caller.shipId },
        { status: input.status, at: deps.clock.now(), actor: shipActor(caller.shipId) },
      );
      if (!reported.isOk) {
        return reported;
      }
      if (reported.value.events.length > 0) {
        await tx.crewRequests.save(reported.value.request);
      }
      for (const event of reported.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
