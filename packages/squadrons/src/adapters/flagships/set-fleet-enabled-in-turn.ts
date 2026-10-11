/**
 * The switch-off in the fleet's turn (#626): its withdrawal waits for the
 * rescan in flight, so that rescan cannot declare the rules again after the
 * switch-off withdrew them.
 */
import { createSetFleetEnabled, type SetFleetEnabled } from '../../core/installation/set-fleet-enabled.js';
import type { FleetTurns } from './fleet-turns.js';

export function createSetFleetEnabledInTurn(deps: Parameters<typeof createSetFleetEnabled>[0] & { turns: FleetTurns }): SetFleetEnabled {
  const { turns, withdraw, ...rest } = deps;
  return createSetFleetEnabled({ ...rest, withdraw: (fleetId) => turns.take(fleetId, () => withdraw(fleetId)) });
}
