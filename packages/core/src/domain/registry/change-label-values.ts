import type { IdGenerator, LabelId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { changeLabelValues, type ChangeLabelValuesRefusal, type LabelValue } from './label.js';
import type { LabelRepository, ShipRepository } from './ports.js';

export interface ChangeLabelValuesTx {
  ships: Pick<ShipRepository, 'find'>;
  labels: Pick<LabelRepository, 'findForUpdate' | 'carriersOf' | 'save'>;
  events: EventLog;
}

export type ChangeLabelValuesFailure = DomainError<'LABEL_NOT_FOUND'> | ChangeLabelValuesRefusal;

export type ChangeLabelValues = (caller: Caller, input: { labelId: LabelId; values: readonly string[] }) => Promise<Result<{ values: readonly LabelValue[] }, ChangeLabelValuesFailure>>;

/**
 * Use case: a label's owner gives it the values it has from now on (decision
 * 0031). Its scope (labels:define) is checked before this runs. In one unit
 * of work, locking the label first, so an assignment of a value being
 * removed either comes before and is seen here, or waits and finds the value
 * gone: the values, a value kept with its id and a new one with a new id, and LabelValuesChanged.
 */
export function createChangeLabelValues(deps: { uow: UnitOfWork<ChangeLabelValuesTx>; clock: Clock; ids: IdGenerator }): ChangeLabelValues {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<{ values: readonly LabelValue[] }, ChangeLabelValuesFailure>> => {
      const { fleetId } = caller;
      const label = await tx.labels.findForUpdate(fleetId, input.labelId);
      if (!label) {
        return refuse('LABEL_NOT_FOUND', `The fleet has no label ${input.labelId}`);
      }
      const nameOf = async (shipId: Caller['shipId']) => (await tx.ships.find(fleetId, shipId))?.name ?? shipId;
      const carriers = await Promise.all(
        (await tx.labels.carriersOf(fleetId, label.id)).map(async (carried) => ({ valueId: carried.valueId, shipName: await nameOf(carried.shipId) })),
      );
      const changed = changeLabelValues(
        { label, ownerName: await nameOf(label.ownerShipId), carriers },
        { callerShipId: caller.shipId, values: input.values.map((value) => ({ value, newId: deps.ids('labelValue') })), at: deps.clock.now(), actor: shipActor(caller.shipId) },
      );
      if (!changed.isOk) {
        return changed;
      }
      if (changed.value.events.length > 0) {
        await tx.labels.save(changed.value.label);
      }
      for (const event of changed.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ values: changed.value.label.values });
    });
}
