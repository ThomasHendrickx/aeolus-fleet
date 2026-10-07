import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { unassignLabel, type UnassignLabelRefusal } from './label.js';
import type { LabelRepository, ShipRepository } from './ports.js';

export interface UnassignLabelTx {
  ships: Pick<ShipRepository, 'find' | 'findForUpdate'>;
  labels: Pick<LabelRepository, 'findForShare' | 'carriedBy' | 'unassign'>;
  events: EventLog;
}

export type UnassignLabelFailure = DomainError<'SHIP_NOT_FOUND' | 'LABEL_NOT_FOUND'> | UnassignLabelRefusal;

export type UnassignLabel = (caller: Caller, input: { shipId: ShipId; key: string }) => Promise<Result<undefined, UnassignLabelFailure>>;

/**
 * Use case: a label's owner takes it off a ship (decision 0031). Its scope
 * (labels:assign) is checked before this runs. In one unit of work, locking
 * the ship, then holding the label, as an assignment does: the assignment
 * goes, with LabelUnassigned.
 */
export function createUnassignLabel(deps: { uow: UnitOfWork<UnassignLabelTx>; clock: Clock; ids: IdGenerator }): UnassignLabel {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, UnassignLabelFailure>> => {
      const { fleetId } = caller;
      const ship = await tx.ships.findForUpdate(fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const label = await tx.labels.findForShare(fleetId, input.key);
      if (!label) {
        return refuse('LABEL_NOT_FOUND', `The fleet has no label ${input.key}`);
      }
      const owner = await tx.ships.find(fleetId, label.ownerShipId);
      const unassigned = unassignLabel(
        { label, ownerName: owner?.name ?? label.ownerShipId, ship, carried: await tx.labels.carriedBy(fleetId, ship.id) },
        { callerShipId: caller.shipId, at: deps.clock.now(), actor: shipActor(caller.shipId) },
      );
      if (!unassigned.isOk) {
        return unassigned;
      }
      if (unassigned.value.unassigned) {
        await tx.labels.unassign(unassigned.value.unassigned);
      }
      for (const event of unassigned.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
