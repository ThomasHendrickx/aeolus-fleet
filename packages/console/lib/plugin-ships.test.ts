import { describe, expect, it } from 'vitest';

import { pluginShipIdsOf } from './plugin-ships';

const connected = (shipId: string) => ({ configured: true as const, connection: { isEnabled: true, state: 'connected' as const, ship: { shipId, name: 'plugin' }, lastShipId: shipId } });

describe('pluginShipIdsOf (#368)', () => {
  it("holds squadrons' and the trierarch plugin's ship, each as connected", () => {
    expect([...pluginShipIdsOf([connected('shp_squadrons'), connected('shp_trierarch_plugin')])]).toEqual(['shp_squadrons', 'shp_trierarch_plugin']);
  });

  it('holds the ship a plugin was last connected as, while it is not connected', () => {
    expect([...pluginShipIdsOf([{ configured: true, connection: { isEnabled: true, state: 'not-connected', ship: null, lastShipId: 'shp_squadrons' } }])]).toEqual(['shp_squadrons']);
  });

  it('holds none for a console without the plugin, one never connected, or one still loading', () => {
    expect(pluginShipIdsOf([{ configured: false }, { configured: true, connection: { isEnabled: true, state: 'not-connected', ship: null, lastShipId: null } }, undefined]).size).toBe(0);
  });
});
