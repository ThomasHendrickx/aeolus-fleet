import type { IdGenerator, LabelValueId, ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { assignLabel, type AssignLabelRefusal } from './label.js';
import type { LabelRepository, ShipRepository } from './ports.js';

export interface AssignLabelTx {
  ships: Pick<ShipRepository, 'find' | 'findForUpdate'>;
  labels: Pick<LabelRepository, 'findByValueForShare' | 'carriedBy' | 'assign'>;
  events: EventLog;
}

export type AssignLabelFailure = DomainError<'SHIP_NOT_FOUND' | 'LABEL_VALUE_NOT_FOUND'> | AssignLabelRefusal;

export type AssignLabel = (caller: Caller, input: { shipId: ShipId; valueId: LabelValueId }) => Promise<Result<undefined, AssignLabelFailure>>;

/**
 * Use case: a label's owner gives a ship one of its values, by the value's id (decision 0031).
 * Its scope (labels:assign) is checked before this runs. In one unit of
 * work, locking the ship first, as a retire does, so two assignments to one
 * ship take turns at its label limit and a retired ship gets none; then
 * holding the label, so a change of its values or its retirement waits: the
 * assignment and LabelAssigned.
 */
export function createAssignLabel(deps: { uow: UnitOfWork<AssignLabelTx>; clock: Clock; ids: IdGenerator }): AssignLabel {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, AssignLabelFailure>> => {
      const { fleetId } = caller;
      const ship = await tx.ships.findForUpdate(fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const label = await tx.labels.findByValueForShare(fleetId, input.valueId);
      // Read after the lock: a change of values that came first may have removed the value.
      if (!label?.values.some((value) => value.id === input.valueId)) {
        return refuse('LABEL_VALUE_NOT_FOUND', `The fleet has no label value ${input.valueId}`);
      }
      const owner = await tx.ships.find(fleetId, label.ownerShipId);
      const assigned = assignLabel(
        { label, ownerName: owner?.name ?? label.ownerShipId, ship, carried: await tx.labels.carriedBy(fleetId, ship.id) },
        { callerShipId: caller.shipId, valueId: input.valueId, at: deps.clock.now(), actor: shipActor(caller.shipId) },
      );
      if (!assigned.isOk) {
        return assigned;
      }
      if (assigned.value.assignment) {
        await tx.labels.assign(assigned.value.assignment);
      }
      for (const event of assigned.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
