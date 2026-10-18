import { isInReadReach } from '@aeolus-fleet/common';

/** The ships as read whole. Fails the test if one is outside the caller's read reach (decision 0034). */
export function wholeShips<Ship extends { name: string }>(ships: readonly Ship[]): Exclude<Ship, { isInReadReach: false }>[] {
  return ships.map((ship) => {
    if (!isInReadReach(ship)) {
      throw new Error(`Expected every ship whole, but ${ship.name} is outside read reach`);
    }
    return ship;
  });
}
