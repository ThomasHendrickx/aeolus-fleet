'use client';

import { useSquadronsSettings, type SquadronsSettings } from './squadrons';
import { useTrierarchPluginSettings, type TrierarchPluginSettings } from './trierarch-plugin';

/** A plugin's connection as the console reads it: the ship it is connected as, or was last. */
type PluginSettings = SquadronsSettings | TrierarchPluginSettings;

/**
 * The ships the console's plugins run as (#368): squadrons' management ship
 * and the trierarch plugin's ship, the one each is connected as or was last.
 * A trierarch's ship, a machine, is no plugin ship.
 */
export function pluginShipIdsOf(plugins: readonly (PluginSettings | undefined)[]): ReadonlySet<string> {
  return new Set(
    plugins.flatMap((plugin) => {
      if (plugin?.configured !== true) {
        return [];
      }
      const shipId = plugin.connection.ship?.shipId ?? plugin.connection.lastShipId;
      return shipId === null ? [] : [shipId];
    }),
  );
}

/** The ships the console's plugins run as, from what it knows of each plugin's connection. */
export function usePluginShipIds(): ReadonlySet<string> {
  const squadrons = useSquadronsSettings();
  const trierarchPlugin = useTrierarchPluginSettings();
  return pluginShipIdsOf([squadrons.data, trierarchPlugin.data]);
}
