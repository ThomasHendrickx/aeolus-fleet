import type { ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { NetworkRule } from './network-settings.js';
import type { DeclaredNetworkRulesRepository } from './ports.js';

export type ReadDeclaredNetworkRules = (caller: Caller) => Promise<{ shipId: ShipId; rules: readonly NetworkRule[] }[]>;

/**
 * Use case: the fleet's networking plugin reads every ship's declared rules,
 * each ship with its whole list, to add them to argo's when it supplies the
 * list (decision 0037). Its scope (fleet:network) is checked before this runs.
 */
export function createReadDeclaredNetworkRules(deps: { declaredNetworkRules: Pick<DeclaredNetworkRulesRepository, 'list'> }): ReadDeclaredNetworkRules {
  return async (caller) => (await deps.declaredNetworkRules.list(caller.fleetId)).map(({ shipId, rules }) => ({ shipId, rules }));
}
