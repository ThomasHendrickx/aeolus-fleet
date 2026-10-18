import type { ListedShip, NetworkRule, ShipId } from '@aeolus-fleet/common';

/**
 * The rules plugins declared on the labels they own, as Network shows them
 * apart from argo's own (design point 6 on #573; decision 0037): each list
 * with the ship that declared it, argo's to read, never to edit.
 */

/** One ship's declared rules, with the name of the ship that declared them. */
export interface DeclaredRules {
  shipId: ShipId;
  declaredBy: string;
  rules: readonly NetworkRule[];
}

/** Each ship that declares rules, by name; a ship the snapshot does not hold yet goes by its id. */
export function declaredRulesOf(
  declared: readonly { shipId: ShipId; rules: readonly NetworkRule[] }[],
  ships: readonly Pick<ListedShip, 'id' | 'name'>[],
): DeclaredRules[] {
  const nameOf = new Map(ships.map((ship) => [ship.id, ship.name]));
  return declared
    .filter(({ rules }) => rules.length > 0)
    .map(({ shipId, rules }) => ({ shipId, declaredBy: nameOf.get(shipId) ?? shipId, rules }))
    .sort((first, second) => first.declaredBy.localeCompare(second.declaredBy));
}
