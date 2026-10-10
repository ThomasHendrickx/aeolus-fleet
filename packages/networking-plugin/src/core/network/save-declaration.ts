import type { FleetId, NetworkPluginDeclaration } from '@aeolus-fleet/common';

import { networkOf } from './declaration.js';
import type { FleetNetworks } from './ports.js';
import type { Supplies, SupplyState } from './supplies.js';

export type SaveDeclaration = (input: { fleetId: FleetId; declaration: NetworkPluginDeclaration }) => Promise<{ declaration: NetworkPluginDeclaration; supply: SupplyState }>;

/**
 * Use case: argo sets what the networking plugin declares for the fleet
 * while it is unavailable, and after how long it is not responding (Thomas on
 * #260). The plugin keeps it with the rules and registers again with it at
 * once, supplying the rules again; while the fleet does not answer it waits,
 * kept, for a retry.
 */
export function createSaveDeclaration(deps: { networks: FleetNetworks; supplies: Supplies }): SaveDeclaration {
  return async ({ fleetId, declaration }) => {
    const { rules } = networkOf(await deps.networks.find(fleetId));
    await deps.networks.save(fleetId, { rules, declaration });
    return { declaration, supply: await deps.supplies.supply(fleetId) };
  };
}
