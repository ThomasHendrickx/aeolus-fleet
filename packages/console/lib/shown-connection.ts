import type { PluginConnection, ScopesRead } from './connect-plugin';

/**
 * A plugin's connection as the browser may know it (decision 0033): `none`
 * when the console has no such plugin or it is off for this fleet, which look
 * the same, so the browser never learns which plugins a fleet has off.
 * Connected, it holds the read of its ship's scopes: those the plugin lists
 * that the ship lacks, which Settings offers to grant (#1226), or the read's
 * failure, which Settings shows with Try again (#1259).
 */
export type ShownConnection =
  | { state: 'none' }
  | { state: 'not-connected'; ship: { shipId: string; name: string } | null; lastShipId: string | null }
  | { state: 'connected'; ship: { shipId: string; name: string } | null; lastShipId: string | null; scopes: ScopesRead };

/** The connection as shown: nothing of a plugin that is off. */
export function shownConnectionOf(connection: PluginConnection | undefined, scopes: ScopesRead): ShownConnection {
  if (connection?.isEnabled !== true) {
    return { state: 'none' };
  }
  const { state, ship, lastShipId } = connection;
  return state === 'connected' ? { state, ship, lastShipId, scopes } : { state, ship, lastShipId };
}
