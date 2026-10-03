import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakeManagementFleet, memoryManagementStore } from '../../../test/support/management-fakes.js';
import { createReadConnection } from './read-connection.js';

const AT = new Date('2026-10-03T11:00:00.000Z');

let fleet: ReturnType<typeof fakeManagementFleet>;
let store: ReturnType<typeof memoryManagementStore>;

beforeEach(() => {
  fleet = fakeManagementFleet();
  store = memoryManagementStore();
});

const read = () => createReadConnection({ door: fleet.door, store })();

describe('reading the connection', () => {
  it('is not connected before squadrons was ever connected', async () => {
    await expect(read()).resolves.toEqual({ state: 'not-connected', ship: null, lastShipId: null });
  });

  it('is connected as the ship while its kept crew token works', async () => {
    fleet.state.liveTokens.add('aeolus_ct_v1_kept');
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, crewToken: 'aeolus_ct_v1_kept', crewedAt: AT });

    await expect(read()).resolves.toEqual({ state: 'connected', ship: { shipId: SHIP_ID, name: 'squadrons' }, lastShipId: SHIP_ID });
  });

  it('drops a kept crew token the fleet no longer takes, and is not connected, naming the last ship', async () => {
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, crewToken: 'aeolus_ct_v1_released', crewedAt: AT });

    await expect(read()).resolves.toEqual({ state: 'not-connected', ship: null, lastShipId: SHIP_ID });
    await expect(store.find()).resolves.toBeUndefined();
    await expect(store.binding()).resolves.toEqual({ fleetId: FLEET_ID, shipId: SHIP_ID });
  });
});
