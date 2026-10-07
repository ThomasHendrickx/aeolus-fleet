import type { IdGenerator, LabelId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { defineLabel, type DefineLabelRefusal, type LabelValue } from './label.js';
import type { LabelRepository, ShipRepository } from './ports.js';

export interface DefineLabelTx {
  ships: Pick<ShipRepository, 'find'>;
  labels: Pick<LabelRepository, 'lockKey' | 'findByKey' | 'save'>;
  events: EventLog;
}

/** The new label's id, and its values with their ids. */
export interface DefinedLabel {
  labelId: LabelId;
  values: readonly LabelValue[];
}

export type DefineLabel = (caller: Caller, input: { key: string; values: readonly string[] }) => Promise<Result<DefinedLabel, DefineLabelRefusal>>;

/**
 * Use case: the caller's ship defines a label it then owns (decision 0031).
 * Its scope (labels:define) is checked before this runs. In one unit of work,
 * holding the key's lock so two definitions of one key never both find it
 * free: the label, a new id for it and each of its values, and LabelDefined.
 */
export function createDefineLabel(deps: { uow: UnitOfWork<DefineLabelTx>; clock: Clock; ids: IdGenerator }): DefineLabel {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<DefinedLabel, DefineLabelRefusal>> => {
      const { fleetId } = caller;
      await tx.labels.lockKey(fleetId, input.key);
      const label = await tx.labels.findByKey(fleetId, input.key);
      const owner = label && (await tx.ships.find(fleetId, label.ownerShipId));
      const defined = defineLabel(
        { owner: { fleetId, id: caller.shipId }, existing: label && { label, ownerName: owner?.name ?? label.ownerShipId } },
        {
          id: deps.ids('label'),
          key: input.key,
          values: input.values.map((value) => ({ value, newId: deps.ids('labelValue') })),
          at: deps.clock.now(),
          actor: shipActor(caller.shipId),
        },
      );
      if (!defined.isOk) {
        return defined;
      }
      await tx.labels.save(defined.value.label);
      for (const event of defined.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ labelId: defined.value.label.id, values: defined.value.label.values });
    });
}
