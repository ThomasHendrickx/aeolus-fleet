import type { IdGenerator, SetBuiltInRuleInput } from '@aeolus-fleet/common';

import { actorOf, isShipCaller, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { setBuiltInRule, type SetBuiltInRuleRefusal } from './network-settings.js';
import type { NetworkSettingsRepository } from './ports.js';

export interface SetBuiltInRuleTx {
  networkSettings: Pick<NetworkSettingsRepository, 'findForUpdate' | 'save'>;
  events: EventLog;
}

export type SetBuiltInRule = (caller: Caller, input: SetBuiltInRuleInput) => Promise<Result<{ version: number }, SetBuiltInRuleRefusal>>;

/**
 * Use case: a built-in rule turned on or off (decision 0034): the viewer
 * reading by any actor, open for one verb by the fleet's networking plugin.
 * Its scope (fleet:network) is checked before this runs. In one
 * unit of work, holding the settings exclusively so no send is checked
 * halfway: the settings at their next version, and BuiltInRuleChanged. A rule
 * already as asked answers the version it has.
 */
export function createSetBuiltInRule(deps: { uow: UnitOfWork<SetBuiltInRuleTx>; clock: Clock; ids: IdGenerator }): SetBuiltInRule {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<{ version: number }, SetBuiltInRuleRefusal>> => {
      const current = await tx.networkSettings.findForUpdate(caller.fleetId);
      const set = setBuiltInRule(current, {
        input,
        caller: { shipId: isShipCaller(caller) ? caller.shipId : null },
        at: deps.clock.now(),
        actor: actorOf(caller),
      });
      if (!set.isOk) {
        return set;
      }
      if (set.value.events.length > 0) {
        await tx.networkSettings.save(set.value.settings);
      }
      for (const event of set.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ version: set.value.settings.version });
    });
}
