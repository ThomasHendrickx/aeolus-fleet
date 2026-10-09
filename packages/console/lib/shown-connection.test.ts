import { describe, expect, it } from 'vitest';

import { shownConnectionOf } from './shown-connection';

const ship = { shipId: 'shp_01m48v8ny2pyv0jtpjfzw1n5vs', name: 'squadrons' };

describe('a plugin connection as the browser sees it', () => {
  it('is none without the plugin', () => {
    expect(shownConnectionOf(undefined)).toEqual({ state: 'none' });
  });

  it('is none while the plugin is off for the fleet, with no trace of its ship', () => {
    expect(shownConnectionOf({ isEnabled: false, state: 'connected', ship, lastShipId: ship.shipId })).toEqual({ state: 'none' });
  });

  it('shows the state and ship of a plugin that is on', () => {
    expect(shownConnectionOf({ isEnabled: true, state: 'connected', ship, lastShipId: ship.shipId })).toEqual({ state: 'connected', ship, lastShipId: ship.shipId });
  });

  it('shows a plugin that is on but not connected', () => {
    expect(shownConnectionOf({ isEnabled: true, state: 'not-connected', ship: null, lastShipId: null })).toEqual({ state: 'not-connected', ship: null, lastShipId: null });
  });
});
