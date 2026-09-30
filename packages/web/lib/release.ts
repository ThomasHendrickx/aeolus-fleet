import type { ListedShip } from '@aeolus-fleet/common';

/**
 * True when the console offers Release for the ship: a session crews it, and
 * it is not argo, which is never released (docs/design/conventions.md). A ship
 * awaiting crew has no session to free; it gets a new starting prompt instead.
 */
export function isReleasable(ship: Pick<ListedShip, 'kind' | 'status'>): boolean {
  return ship.kind === 'agent' && ship.status === 'crewed';
}
