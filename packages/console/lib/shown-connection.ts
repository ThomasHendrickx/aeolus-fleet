import type { Scope } from '@aeolus-fleet/common';

import type { PluginConnection } from './connect-plugin';

/**
 * A plugin's connection as the browser may know it (decision 0033): `none`
 * when the console has no such plugin or it is off for this fleet, which look
 * the same, so the browser never learns which plugins a fleet has off.
 * Connected, it names the scopes the plugin lists that its ship lacks, which
 * Settings offers to grant (#1226).
 */
export type ShownConnection =
  | { state: 'none' }
  | { state: 'not-connected'; ship: { shipId: string; name: string } | null; lastShipId: string | null }
  | { state: 'connected'; ship: { shipId: string; name: string } | null; lastShipId: string | null; missingScopes: Scope[] };

/** The connection as shown: nothing of a plugin that is off. */
export function shownConnectionOf(connection: PluginConnection | undefined, missingScopes: Scope[]): ShownConnection {
  if (connection?.isEnabled !== true) {
    return { state: 'none' };
  }
  const { state, ship, lastShipId } = connection;
  return state === 'connected' ? { state, ship, lastShipId, missingScopes } : { state, ship, lastShipId };
}
