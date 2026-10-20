import type { IdGenerator } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { declareNetworkRules, namedInRules, type DeclareNetworkRulesRefusal } from './declared-network-rules.js';
import { labelOwnerOf, ownerNameOf, type Label } from './label.js';
import type { NetworkRule } from './network-settings.js';
import type { DeclaredNetworkRulesRepository, LabelRepository, NetworkSettingsRepository, ShipRepository } from './ports.js';

export interface DeclareNetworkRulesTx {
  labels: Pick<LabelRepository, 'find' | 'findByValueForShare'>;
  ships: Pick<ShipRepository, 'find'>;
  declaredNetworkRules: Pick<DeclaredNetworkRulesRepository, 'save'>;
  networkSettings: Pick<NetworkSettingsRepository, 'findForUpdate' | 'save'>;
  events: EventLog;
}

export type DeclareNetworkRules = (caller: Caller, input: { rules: readonly NetworkRule[] }) => Promise<Result<{ rules: number }, DeclareNetworkRulesRefusal>>;

/**
 * Use case: a ship or the installation declares the network rules it needs
 * on the labels it owns, its whole list, or none to withdraw them (decisions
 * 0037, 0052); an account owns no label, so it is refused. Its scope
 * (labels:define) is checked before this runs. In one unit of work: the
 * labels its terms name as the fleet has them now, its list in place of the
 * one before, in force beside the fleet's own rules, the settings at their
 * next version, and NetworkRulesDeclared. The settings are held exclusively
 * after the labels, as an assignment takes them, so no check runs halfway.
 */
export function createDeclareNetworkRules(deps: { uow: UnitOfWork<DeclareNetworkRulesTx>; clock: Clock; ids: IdGenerator }): DeclareNetworkRules {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<{ rules: number }, DeclareNetworkRulesRefusal>> => {
      const { fleetId } = caller;
      const { labelIds, valueIds } = namedInRules(input.rules);
      const found = await Promise.all([...labelIds.map((labelId) => tx.labels.find(fleetId, labelId)), ...valueIds.map((valueId) => tx.labels.findByValueForShare(fleetId, valueId))]);
      const labels = found.filter((label): label is Label => label !== undefined);
      const ownerNames = new Map(await Promise.all(labels.map(async (label) => [label.id, await ownerNameOf(label.owner, async (owner) => (await tx.ships.find(fleetId, owner))?.name)] as const)));
      const declared = declareNetworkRules(
        { labels, ownerNameOf: (label) => ownerNames.get(label.id) ?? 'its owner' },
        { settings: await tx.networkSettings.findForUpdate(fleetId), declarer: labelOwnerOf(caller), rules: input.rules, at: deps.clock.now(), actor: actorOf(caller) },
      );
      if (!declared.isOk) {
        return declared;
      }
      await tx.declaredNetworkRules.save(declared.value.declared);
      await tx.networkSettings.save(declared.value.settings);
      for (const event of declared.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ rules: declared.value.declared.rules.length });
    });
}
