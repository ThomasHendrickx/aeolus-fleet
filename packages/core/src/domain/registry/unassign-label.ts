import type { IdGenerator, LabelValueId, ShipId } from '@aeolus-fleet/common';

import { actorOf, hasScope, isShipCaller, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { labelOwnerOf, ownerNameOf, unassignLabel, type UnassignLabelRefusal } from './label.js';
import { checkManage, keepingReachRefusal, type CheckManageTx, type NotReachable } from './check-reach.js';
import type { LabelRepository, ShipRepository } from './ports.js';

export interface UnassignLabelTx extends Omit<CheckManageTx, 'ships' | 'labels'> {
  ships: Pick<ShipRepository, 'find' | 'findForUpdate'>;
  labels: Pick<LabelRepository, 'findByValueForShare' | 'carriedBy' | 'unassign'> & CheckManageTx['labels'];
  events: EventLog;
}

export type UnassignLabelFailure = DomainError<'SHIP_NOT_FOUND' | 'LABEL_VALUE_NOT_FOUND'> | UnassignLabelRefusal | NotReachable;

export type UnassignLabel = (caller: Caller, input: { shipId: ShipId; valueId: LabelValueId }) => Promise<Result<undefined, UnassignLabelFailure>>;

/**
 * Use case: a label's owner takes one of its values off a ship, by the value's id (decision 0031),
 * or an actor holding labels:any any label's value off a ship within its
 * manage reach (decision 0053). Its scope
 * (labels:assign) is checked before this runs. In one unit of work, locking
 * the ship, then holding the label, as an assignment does: the assignment
 * goes, with LabelUnassigned.
 */
export function createUnassignLabel(deps: { uow: UnitOfWork<UnassignLabelTx>; clock: Clock; ids: IdGenerator }): UnassignLabel {
  return (caller, input) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<undefined, UnassignLabelFailure>> => {
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
      const at = deps.clock.now();
      const labeller = { owner: labelOwnerOf(caller), shipId: isShipCaller(caller) ? caller.shipId : null, canLabelAnyShip: hasScope(caller, 'labels:any') };
      if (labeller.canLabelAnyShip) {
        const managed = await checkManage({ tx, ids: deps.ids }, { manager: caller, shipId: ship.id, at });
        if (!managed.isOk) {
          return managed;
        }
      }
      const unassigned = unassignLabel(
        { label, ownerName: await ownerNameOf(label.owner, async (shipId) => (await tx.ships.find(fleetId, shipId))?.name), ship, carried: await tx.labels.carriedBy(fleetId, ship.id) },
        { caller: labeller, valueId: input.valueId, at, actor: actorOf(caller) },
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
