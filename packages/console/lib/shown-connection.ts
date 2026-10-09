import type { PluginConnection } from './connect-plugin';

/**
 * A plugin's connection as the browser may know it (decision 0033): `none`
 * when the console has no such plugin or it is off for this fleet, which look
 * the same, so the browser never learns which plugins a fleet has off.
 */
export type ShownConnection =
  | { state: 'none' }
  | { state: 'not-connected' | 'connected'; ship: { shipId: string; name: string } | null; lastShipId: string | null };

/** The connection as shown: nothing of a plugin that is off. */
export function shownConnectionOf(connection: PluginConnection | undefined): ShownConnection {
  if (connection?.isEnabled !== true) {
    return { state: 'none' };
  }
  return { state: connection.state, ship: connection.ship, lastShipId: connection.lastShipId };
}
