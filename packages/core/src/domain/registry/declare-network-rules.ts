import type { IdGenerator } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { declareNetworkRules, namedInRules, type DeclareNetworkRulesRefusal } from './declared-network-rules.js';
import type { Label } from './label.js';
import type { NetworkRule } from './network-settings.js';
import type { DeclaredNetworkRulesRepository, LabelRepository, ShipRepository } from './ports.js';

export interface DeclareNetworkRulesTx {
  labels: Pick<LabelRepository, 'find' | 'findByValueForShare'>;
  ships: Pick<ShipRepository, 'find'>;
  declaredNetworkRules: Pick<DeclaredNetworkRulesRepository, 'save'>;
  events: EventLog;
}

export type DeclareNetworkRules = (caller: Caller, input: { rules: readonly NetworkRule[] }) => Promise<Result<{ rules: number }, DeclareNetworkRulesRefusal>>;

/**
 * Use case: a ship declares the network rules it needs on the labels it owns,
 * its whole list, or none to withdraw them (decision 0037). Its scope
 * (labels:define) is checked before this runs. In one unit of work: the
 * labels its terms name as the fleet has them now, its list in place of the
 * one before, and NetworkRulesDeclared. Nothing comes in force here: the
 * networking plugin adds them to argo's rules when it supplies the list.
 */
export function createDeclareNetworkRules(deps: { uow: UnitOfWork<DeclareNetworkRulesTx>; clock: Clock; ids: IdGenerator }): DeclareNetworkRules {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<{ rules: number }, DeclareNetworkRulesRefusal>> => {
      const { fleetId, shipId } = caller;
      const { labelIds, valueIds } = namedInRules(input.rules);
      const found = await Promise.all([...labelIds.map((labelId) => tx.labels.find(fleetId, labelId)), ...valueIds.map((valueId) => tx.labels.findByValueForShare(fleetId, valueId))]);
      const labels = found.filter((label): label is Label => label !== undefined);
      const ownerNames = new Map(await Promise.all(labels.map(async (label) => [label.ownerShipId, (await tx.ships.find(fleetId, label.ownerShipId))?.name ?? label.ownerShipId] as const)));
      const declared = declareNetworkRules(
        { labels, ownerNameOf: (ownerShipId) => ownerNames.get(ownerShipId) ?? ownerShipId },
        { fleetId, shipId, rules: input.rules, at: deps.clock.now(), actor: shipActor(shipId) },
      );
      if (!declared.isOk) {
        return declared;
      }
      await tx.declaredNetworkRules.save(declared.value.declared);
      for (const event of declared.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ rules: declared.value.declared.rules.length });
    });
}
