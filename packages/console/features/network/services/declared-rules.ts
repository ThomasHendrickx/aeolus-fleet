import type { Declarer, ListedShip, NetworkRule, ShipId } from '@aeolus-fleet/common';

/**
 * The rules plugins and the installation declared on the labels they own, as
 * Network shows them apart from argo's own (design point 6 on #573;
 * decisions 0037, 0052): each list with its declarer, argo's to read, never
 * to edit.
 */

/** One declarer's rules, with its name: a ship's, or the installation. */
export interface DeclaredRules {
  declarerId: ShipId | 'installation';
  declaredBy: string;
  rules: readonly NetworkRule[];
}

/** Each declarer of rules, by name; a ship the snapshot does not hold yet goes by its id. */
export function declaredRulesOf(declared: readonly { declarer: Declarer; rules: readonly NetworkRule[] }[], ships: readonly Pick<ListedShip, 'id' | 'name'>[]): DeclaredRules[] {
  const nameOf = new Map(ships.map((ship) => [ship.id, ship.name]));
  return declared
    .filter(({ rules }) => rules.length > 0)
    .map(({ declarer, rules }) =>
      declarer.kind === 'installation'
        ? { declarerId: 'installation' as const, declaredBy: 'the installation', rules }
        : { declarerId: declarer.shipId, declaredBy: nameOf.get(declarer.shipId) ?? declarer.shipId, rules },
    )
    .sort((first, second) => first.declaredBy.localeCompare(second.declaredBy));
}
