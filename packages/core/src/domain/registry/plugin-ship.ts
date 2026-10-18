import type { ScopeNamespaceRepository } from './ports.js';
import type { Ship } from './ship.js';

export interface PluginShipTx {
  scopeNamespaces: Pick<ScopeNamespaceRepository, 'findByDeclarer'>;
}

/**
 * Whether the ship is a plugin's, which may do what only a plugin does, such
 * as name the owner of the ship that asked it (decision 0045). For now, a
 * ship that declared a plugin namespace (decision 0046). The one place this
 * is decided: whether it becomes a core scope of its own is open with Thomas.
 */
export async function isPluginShip(tx: PluginShipTx, ship: Pick<Ship, 'fleetId' | 'id'>): Promise<boolean> {
  return (await tx.scopeNamespaces.findByDeclarer(ship.fleetId, ship.id)) !== undefined;
}
