import { NETWORK_VERBS, type BuiltInRuleState } from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { NetworkSettingsRepository } from './ports.js';

export interface ReadBuiltInRulesTx {
  networkSettings: Pick<NetworkSettingsRepository, 'findForShare'>;
}

export type ReadBuiltInRules = (caller: ShipCaller) => Promise<Result<BuiltInRuleState[], never>>;

/**
 * Use case: every built-in rule of the caller's fleet as it is now (decision
 * 0034), in the order the rule list shows them, first: argo, the owner, the
 * answer and a connected plugin's reading, always on; the viewer reading as argo turned it; open per verb
 * as the networking plugin turned it. Its scope (fleet:network, which argo
 * holds) is checked before this runs. Read under the shared settings lock,
 * so it answers one version.
 */
export function createReadBuiltInRules(deps: { uow: UnitOfWork<ReadBuiltInRulesTx> }): ReadBuiltInRules {
  return (caller) =>
    deps.uow.run(async (tx): Promise<Result<BuiltInRuleState[], never>> => {
      const { builtIns } = await tx.networkSettings.findForShare(caller.fleetId);
      return ok([
        { rule: 'argo', isOn: true },
        { rule: 'owner', isOn: true },
        { rule: 'answer', isOn: true },
        { rule: 'pluginRead', isOn: true },
        { rule: 'viewerRead', isOn: builtIns.isViewerReadOn },
        ...NETWORK_VERBS.map((verb) => ({ rule: 'open' as const, verb, isOn: builtIns.open[verb] })),
      ]);
    });
}
