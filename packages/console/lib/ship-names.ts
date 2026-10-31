import type { ListedShip, ShipId } from '@aeolus-fleet/common';

/** The names of the listed ships by id, those outside the read reach too: they show their name (decision 0034). */
export function shipNamesOf(ships: readonly Pick<ListedShip, 'id' | 'name'>[]): ReadonlyMap<ShipId, string> {
  return new Map(ships.map((ship) => [ship.id, ship.name]));
}
