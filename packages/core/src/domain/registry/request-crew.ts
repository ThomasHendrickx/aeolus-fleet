import type { IdGenerator, LabelValueId, ShipId } from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { machineLabelsOf, requestCrew, type RequestCrewRefusal } from './crew-request.js';
import { checkManage, keepingReachRefusal, type CheckManageTx, type NotReachable } from './check-reach.js';
import type { CrewRequestRepository, LabelRepository, ShipRepository } from './ports.js';
import type { JsonObject } from './report-details.js';

export interface RequestCrewTx extends Omit<CheckManageTx, 'ships' | 'labels'> {
  ships: Pick<ShipRepository, 'find' | 'findForUpdate'>;
  crewRequests: CrewRequestRepository;
  labels: Pick<LabelRepository, 'findByValueForShare' | 'carriedBy' | 'find' | 'findByKey'>;
  events: EventLog;
}

export type RequestCrew = (
  caller: ShipCaller,
  input: { shipId: ShipId; settings: JsonObject },
) => Promise<Result<{ settingsVersion: number }, DomainError<'SHIP_NOT_FOUND'> | NotReachable | RequestCrewRefusal>>;

/**
 * Use case: a requester asks that a ship be kept crewed, with these settings,
 * replacing any request the ship holds. Its scope (fleet:manage) is checked
 * before this runs. In one unit of work, locking the ship first, as a retire
 * does, so a retire and a request never cross; then holding the label of
 * each machine label, as an assignment does, so a change of its values waits
 * and the request never names a value it removed: the request and
 * CrewRequested.
 */
export function createRequestCrew(deps: { uow: UnitOfWork<RequestCrewTx>; clock: Clock; ids: IdGenerator }): RequestCrew {
  return (caller, input) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<{ settingsVersion: number }, DomainError<'SHIP_NOT_FOUND'> | NotReachable | RequestCrewRefusal>> => {
      const ship = await tx.ships.findForUpdate(caller.fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const managed = await checkManage({ tx, ids: deps.ids }, { manager: caller, shipId: ship.id, at: deps.clock.now() });
      if (!managed.isOk) {
        return managed;
      }
      const current = await tx.crewRequests.find(caller.fleetId, ship.id);
      const labelValues = new Set<LabelValueId>();
      for (const valueId of machineLabelsOf(input.settings)) {
        const label = await tx.labels.findByValueForShare(caller.fleetId, valueId);
        // Read after the lock: a change of values that came first may have removed the value.
        if (label?.values.some((value) => value.id === valueId)) {
          labelValues.add(valueId);
        }
      }
      const requested = requestCrew({ ship, current, labelValues }, { settings: input.settings, at: deps.clock.now(), actor: shipActor(caller.shipId) });
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
