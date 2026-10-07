import type { IdGenerator, LabelId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { deleteLabel, type DeleteLabelRefusal } from './label.js';
import type { LabelRepository, ShipRepository } from './ports.js';

export interface DeleteLabelTx {
  ships: Pick<ShipRepository, 'find'>;
  labels: Pick<LabelRepository, 'findForUpdate' | 'carriersOf' | 'remove'>;
  events: EventLog;
}

export type DeleteLabelFailure = DomainError<'LABEL_NOT_FOUND'> | DeleteLabelRefusal;

export type DeleteLabel = (caller: Caller, input: { labelId: LabelId }) => Promise<Result<undefined, DeleteLabelFailure>>;

/**
 * Use case: a label's owner deletes it, freeing its key (decision 0031). Its
 * scope (labels:define) is checked before this runs. In one unit of work,
 * locking the label first, as a change of values does, so an assignment
 * either comes before and is seen here, or waits and finds the label gone:
 * the label goes with its values, with LabelDeleted.
 */
export function createDeleteLabel(deps: { uow: UnitOfWork<DeleteLabelTx>; clock: Clock; ids: IdGenerator }): DeleteLabel {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, DeleteLabelFailure>> => {
      const { fleetId } = caller;
      const label = await tx.labels.findForUpdate(fleetId, input.labelId);
      if (!label) {
        return refuse('LABEL_NOT_FOUND', `The fleet has no label ${input.labelId}`);
      }
      const nameOf = async (shipId: Caller['shipId']) => (await tx.ships.find(fleetId, shipId))?.name ?? shipId;
      const carrierNames = await Promise.all((await tx.labels.carriersOf(fleetId, label.id)).map((carried) => nameOf(carried.shipId)));
      const deleted = deleteLabel(
        { label, ownerName: await nameOf(label.ownerShipId), carrierNames },
        { callerShipId: caller.shipId, at: deps.clock.now(), actor: shipActor(caller.shipId) },
      );
      if (!deleted.isOk) {
        return deleted;
      }
      await tx.labels.remove(fleetId, label.id);
      for (const event of deleted.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
