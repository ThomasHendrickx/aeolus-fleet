import type { IdGenerator } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { refuseNoDraft, type NoNetworkRulesDraft } from './network-rules-draft.js';
import { applyNetworkRules } from './network-settings.js';
import type { NetworkRulesDraftRepository, NetworkSettingsRepository } from './ports.js';

export interface ApplyNetworkRulesTx {
  networkSettings: Pick<NetworkSettingsRepository, 'findForUpdate' | 'save'>;
  networkRulesDrafts: Pick<NetworkRulesDraftRepository, 'find' | 'remove'>;
  events: EventLog;
}

export type ApplyNetworkRulesRefusal = NoNetworkRulesDraft | DomainError<'NETWORK_SETTINGS_CHANGED'>;

export type ApplyNetworkRules = (caller: Caller, input: { version: number }) => Promise<Result<{ version: number }, ApplyNetworkRulesRefusal>>;

/**
 * Use case: any actor holding fleet:network applies the fleet's draft, at
 * the settings version it saw (decisions 0034, 0053), checked before this
 * runs. In one unit of work, holding the settings exclusively so no check
 * runs halfway: the draft's rules in force at the next version, the draft
 * gone, and NetworkRulesSet. A moved version keeps the draft.
 */
export function createApplyNetworkRules(deps: { uow: UnitOfWork<ApplyNetworkRulesTx>; clock: Clock; ids: IdGenerator }): ApplyNetworkRules {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<{ version: number }, ApplyNetworkRulesRefusal>> => {
      const { fleetId } = caller;
      const current = await tx.networkSettings.findForUpdate(fleetId);
      const draft = await tx.networkRulesDrafts.find(fleetId);
      if (draft === undefined) {
        return refuseNoDraft();
      }
      const applied = applyNetworkRules(current, { rules: draft.rules, version: input.version, at: deps.clock.now(), actor: actorOf(caller) });
      if (!applied.isOk) {
        return applied;
      }
      await tx.networkSettings.save(applied.value.settings);
      await tx.networkRulesDrafts.remove(fleetId);
      for (const event of applied.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ version: applied.value.settings.version });
    });
}
