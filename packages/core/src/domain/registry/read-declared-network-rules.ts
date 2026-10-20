import type { Caller } from '../shared/caller.js';
import type { LabelOwner } from './label.js';
import type { NetworkRule } from './network-settings.js';
import type { DeclaredNetworkRulesRepository } from './ports.js';

export type ReadDeclaredNetworkRules = (caller: Caller) => Promise<{ declarer: LabelOwner; rules: readonly NetworkRule[] }[]>;

/**
 * Use case: an actor holding fleet:network reads every declarer's declared
 * rules, each ship or the installation with its whole list, in force beside
 * the fleet's own (decision 0037). Its scope is checked before this runs.
 */
export function createReadDeclaredNetworkRules(deps: { declaredNetworkRules: Pick<DeclaredNetworkRulesRepository, 'list'> }): ReadDeclaredNetworkRules {
  return async (caller) => (await deps.declaredNetworkRules.list(caller.fleetId)).map(({ declarer, rules }) => ({ declarer, rules }));
}
