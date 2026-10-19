import { NETWORK_VERBS, type ExplainedReach, type ReachRule, type ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { reaching, rulesInForceAt, shipAsItIs, type CheckReachTx } from './check-reach.js';
import type { DeclaredNetworkRules } from './declared-network-rules.js';
import { reachRuleOf, type NetworkRule, type ReachRule as SettingsRule } from './network-settings.js';
import { readsShip, type ReadReachOf } from './read-reach.js';
import type { DeclaredNetworkRulesRepository, ShipRepository } from './ports.js';

export interface ExplainReachTx {
  networkSettings: CheckReachTx['networkSettings'];
  ships: Pick<ShipRepository, 'find' | 'listActive'>;
  labels: CheckReachTx['labels'];
  pluginConnections: CheckReachTx['pluginConnections'];
  leases: CheckReachTx['leases'];
  declaredNetworkRules: Pick<DeclaredNetworkRulesRepository, 'list'>;
}

export type ExplainReachFailure = DomainError<'NOT_REACHABLE' | 'SHIP_NOT_FOUND'>;

export type ExplainReach = (caller: Caller, input: { fromShipId: ShipId; toShipId?: ShipId }) => Promise<Result<ExplainedReach, ExplainReachFailure>>;

/**
 * Use case: argo asks which ships a ship reaches now, per verb, or whether it
 * reaches one ship (decision 0034). It answers as a send would be checked at
 * this moment: the rules in force, what the networking plugin declared while
 * it does not respond, the built-in rules. Each ship comes with the rule that
 * allows it: a built-in rule, a rule the plugin supplied, or a rule a ship
 * declared, named by its declarer, when the plugin supplied it as declared.
 * There is no message, so no answer to a sender. It records nothing: an
 * explain is not a send. Any actor holding fleet:explain asks, the scope
 * checked before this runs, about the ships it reads (decision 0053).
 */
export function createExplainReach(deps: { uow: UnitOfWork<ExplainReachTx>; clock: Clock; readReach: ReadReachOf }): ExplainReach {
  return async (caller, input) => {
    const reads = await deps.readReach(caller);
    return deps.uow.run(async (tx): Promise<Result<ExplainedReach, ExplainReachFailure>> => {
      const { fleetId } = caller;
      const from = await tx.ships.find(fleetId, input.fromShipId);
      if (from?.retiredAt !== null) {
        return refuse('SHIP_NOT_FOUND', 'The fleet has no active ship with this id to explain from');
      }
      if (!readsShip(reads, from.id)) {
        return refuse('NOT_REACHABLE', 'The network rules do not let you read the ship to explain from');
      }
      const active = await tx.ships.listActive(fleetId);
      const others = active.filter((ship) => ship.id !== from.id && readsShip(reads, ship.id) && (input.toShipId === undefined || ship.id === input.toShipId));
      if (input.toShipId !== undefined && others.length === 0 && input.toShipId !== from.id) {
        return refuse('SHIP_NOT_FOUND', 'The fleet has no active ship with this id to explain reach to');
      }
      const settings = await tx.networkSettings.findForShare(fleetId);
      const inForce = await rulesInForceAt(tx, { settings, now: deps.clock.now() });
      const declared = await tx.declaredNetworkRules.list(fleetId);
      const sender = reaching(await shipAsItIs(tx, from));
      const explained: ExplainedReach = { send: [], read: [], manage: [] };
      for (const ship of others) {
        const recipient = reaching(await shipAsItIs(tx, ship));
        for (const verb of NETWORK_VERBS) {
          const rule = reachRuleOf(inForce, { verb, sender, recipient, isAnswerToSender: false });
          if (rule !== undefined) {
            explained[verb].push({ shipId: ship.id, rule: namedRule(rule, { rules: inForce.rules, declared }) });
          }
        }
      }
      return ok(explained);
    });
  };
}

/** A rule of the settings named as argo reads it: a declared one by its declarer and its place in that ship's list, any other as the plugin's. */
function namedRule(rule: SettingsRule, held: { rules: readonly NetworkRule[]; declared: readonly DeclaredNetworkRules[] }): ReachRule {
  if ('builtIn' in rule) {
    return rule;
  }
  const text = ruleText(held.rules[rule.index]);
  for (const { shipId, rules } of held.declared) {
    const index = rules.findIndex((each) => ruleText(each) === text);
    if (index !== -1) {
      return { declared: shipId, index };
    }
  }
  return { plugin: rule.index };
}

function ruleText(rule: NetworkRule | undefined): string {
  return JSON.stringify(rule === undefined ? null : [rule.verb, rule.from, rule.to]);
}
