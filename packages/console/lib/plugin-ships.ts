'use client';

import type { ShownConnection } from './shown-connection';
import { useNetworkingPluginSettings } from './networking-plugin';
import { useSquadronsSettings } from './squadrons';
import { useTrierarchPluginSettings } from './trierarch-plugin';

/**
 * The ships the console's plugins run as (#368): squadrons' management ship,
 * the trierarch plugin's ship and the networking plugin's, the one each is connected as or was last.
 * A trierarch's ship, a machine, is no plugin ship.
 */
export function pluginShipIdsOf(plugins: readonly (ShownConnection | undefined)[]): ReadonlySet<string> {
  return new Set(
    plugins.flatMap((plugin) => {
      if (plugin === undefined || plugin.state === 'none') {
        return [];
      }
      const shipId = plugin.ship?.shipId ?? plugin.lastShipId;
      return shipId === null ? [] : [shipId];
    }),
  );
}

/** The ships the console's plugins run as, from what it knows of each plugin's connection. */
export function usePluginShipIds(): ReadonlySet<string> {
  const squadrons = useSquadronsSettings();
  const trierarchPlugin = useTrierarchPluginSettings();
  const networkingPlugin = useNetworkingPluginSettings();
  return pluginShipIdsOf([squadrons.data, trierarchPlugin.data, networkingPlugin.data]);
}
