import type { Caller } from '../shared/caller.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { NetworkRule } from './network-settings.js';
import type { NetworkRulesDraftRepository, NetworkSettingsRepository } from './ports.js';

export interface ReadNetworkRulesTx {
  networkSettings: Pick<NetworkSettingsRepository, 'findForShare'>;
  networkRulesDrafts: Pick<NetworkRulesDraftRepository, 'find'>;
}

export interface ReadNetworkRulesAnswer {
  applied: { rules: readonly NetworkRule[] | null; version: number };
  draft: { rules: readonly NetworkRule[] | null; savedAt: Date; savedAgainstVersion: number } | null;
}

export type ReadNetworkRules = (caller: Caller) => Promise<Result<ReadNetworkRulesAnswer, never>>;

/**
 * Use case: any actor holding fleet:network reads the fleet's own rules as
 * applied, at the settings version, and its draft beside them (decision
 * 0034), checked before this runs. Read under the shared settings lock, so
 * it answers one version.
 */
export function createReadNetworkRules(deps: { uow: UnitOfWork<ReadNetworkRulesTx> }): ReadNetworkRules {
  return (caller) =>
    deps.uow.run(async (tx): Promise<Result<ReadNetworkRulesAnswer, never>> => {
      const { rules, version } = await tx.networkSettings.findForShare(caller.fleetId);
      const draft = await tx.networkRulesDrafts.find(caller.fleetId);
      return ok({
        applied: { rules, version },
        draft: draft === undefined ? null : { rules: draft.rules, savedAt: draft.savedAt, savedAgainstVersion: draft.savedAgainstVersion },
      });
    });
}
