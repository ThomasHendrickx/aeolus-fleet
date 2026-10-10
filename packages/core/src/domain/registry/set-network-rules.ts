import type { IdGenerator } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { setNetworkRules, type NetworkRule, type SetNetworkRulesRefusal } from './network-settings.js';
import type { NetworkSettingsRepository } from './ports.js';

export interface SetNetworkRulesTx {
  networkSettings: Pick<NetworkSettingsRepository, 'findForUpdate' | 'save'>;
  events: EventLog;
}

export type SetNetworkRules = (caller: Caller, input: { rules: readonly NetworkRule[] | null }) => Promise<Result<{ version: number }, SetNetworkRulesRefusal>>;

/**
 * Use case: the caller sets the fleet's network rules, the whole list, or
 * none for all-to-all (decision 0034). Its scope (fleet:network, which argo
 * holds) is checked before this runs. In one unit of work, holding the
 * settings exclusively so no send is checked halfway: the settings at their
 * next version, and NetworkRulesSet.
 */
export function createSetNetworkRules(deps: { uow: UnitOfWork<SetNetworkRulesTx>; clock: Clock; ids: IdGenerator }): SetNetworkRules {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<{ version: number }, SetNetworkRulesRefusal>> => {
      const current = await tx.networkSettings.findForUpdate(caller.fleetId);
      const set = setNetworkRules(current, { rules: input.rules, shipId: caller.shipId, at: deps.clock.now(), actor: shipActor(caller.shipId) });
      if (!set.isOk) {
        return set;
      }
      await tx.networkSettings.save(set.value.settings);
      for (const event of set.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ version: set.value.settings.version });
    });
}
