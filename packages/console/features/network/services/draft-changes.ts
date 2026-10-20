import { NETWORK_VERBS, type ListedShip, type NetworkRulesDraftChanges, type NetworkVerb, type ReachRule, type ShipId } from '@aeolus-fleet/common';

import { BUILT_IN_NAMES } from './built-in-rules';

/**
 * What the draft of the network rules would change, as Network lists it
 * before an apply (decision 0035): per verb, the pairs of ships it gains and
 * loses, by name, each with the rule that allows it on the side that has it.
 * The fleet works the changes out; the browser only names them (decision 0033).
 */

/** One pair of ships a verb gains or loses, and the rule that allows it. */
export interface ReachChangeRow {
  key: string;
  from: string;
  to: string;
  rule: string;
}

/** A verb's gains and losses, the verbs in the fleet's order. */
export interface VerbChanges {
  verb: NetworkVerb;
  gained: ReachChangeRow[];
  lost: ReachChangeRow[];
}

/** A rule by the name Network gives it: a built-in's name, one of the fleet's own by its number, or a declared one by its declarer and number. */
export function ruleNameOf(rule: ReachRule, nameOf: ReadonlyMap<ShipId, string>): string {
  if ('builtIn' in rule) {
    return `Built-in: ${BUILT_IN_NAMES[rule.builtIn]}`;
  }
  if ('rule' in rule) {
    return `Rule ${String(rule.rule + 1)}`;
  }
  const declaredBy = rule.declared.kind === 'installation' ? 'the installation' : (nameOf.get(rule.declared.shipId) ?? rule.declared.shipId);
  return `Declared by ${declaredBy}, rule ${String(rule.index + 1)}`;
}

/** Every verb's changes, each pair by name, a ship the snapshot does not hold yet by its id, sorted by name so the list reads the same each time. */
export function draftChangesOf(changes: NetworkRulesDraftChanges, ships: readonly Pick<ListedShip, 'id' | 'name'>[]): VerbChanges[] {
  const nameOf = new Map(ships.map((ship) => [ship.id, ship.name]));
  const rowsOf = (pairs: NetworkRulesDraftChanges['send']['gained']): ReachChangeRow[] =>
    pairs
      .map(({ fromShipId, toShipId, rule }) => ({
        key: `${fromShipId}>${toShipId}`,
        from: nameOf.get(fromShipId) ?? fromShipId,
        to: nameOf.get(toShipId) ?? toShipId,
        rule: ruleNameOf(rule, nameOf),
      }))
      .sort((first, second) => first.from.localeCompare(second.from) || first.to.localeCompare(second.to));
  return NETWORK_VERBS.map((verb) => ({ verb, gained: rowsOf(changes[verb].gained), lost: rowsOf(changes[verb].lost) }));
}

/** Whether the draft changes no reach at all. */
export function isUnchanged(changes: readonly VerbChanges[]): boolean {
  return changes.every(({ gained, lost }) => gained.length === 0 && lost.length === 0);
}
