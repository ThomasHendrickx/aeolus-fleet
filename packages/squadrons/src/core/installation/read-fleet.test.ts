import type { FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, memoryManagementStore } from '../../../test/support/management-fakes.js';
import { memoryFleetSwitches } from '../../../test/support/memory-installation.js';
import { createReadFleet } from './read-fleet.js';
import { createIsServed } from './served.js';

const OTHER: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const AT = new Date('2026-10-04T12:00:00.000Z');

describe('a fleet as the installation reads it', () => {
  it('is on and connected once switched on and connected; another fleet is neither', async () => {
    const switches = memoryFleetSwitches();
    const management = memoryManagementStore();
    await switches.set(FLEET_ID, { isEnabled: true, at: AT });
    await management.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });
    const read = createReadFleet({ isServed: createIsServed({ installation: 'enabled', switches }), management });

    await expect(read({ fleetId: FLEET_ID })).resolves.toEqual({ isEnabled: true, isConnected: true });
    await expect(read({ fleetId: OTHER })).resolves.toEqual({ isEnabled: false, isConnected: false });
  });

  it('is off but still connected when switched off: its connection is kept for when it is on again', async () => {
    const switches = memoryFleetSwitches();
    const management = memoryManagementStore();
    await management.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });

    await expect(createReadFleet({ isServed: createIsServed({ installation: 'enabled', switches }), management })({ fleetId: FLEET_ID })).resolves.toEqual({ isEnabled: false, isConnected: true });
  });
});
