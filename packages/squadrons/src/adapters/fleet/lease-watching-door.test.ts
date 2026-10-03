import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakeManagementFleet, memoryManagementStore } from '../../../test/support/management-fakes.js';
import { watchManagementLease } from './lease-watching-door.js';

const AT = new Date('2026-10-03T11:00:00.000Z');

let fleet: ReturnType<typeof fakeManagementFleet>;
let store: ReturnType<typeof memoryManagementStore>;

beforeEach(async () => {
  fleet = fakeManagementFleet();
  store = memoryManagementStore();
  await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });
});

describe('watching the management lease', () => {
  it('drops the management crew token when a call made with it answers LEASE_ENDED', async () => {
    await watchManagementLease(fleet.door, store).whoami('aeolus_ct_v1_management');

    await expect(store.find()).resolves.toBeUndefined();
    await expect(store.binding()).resolves.toEqual({ fleetId: FLEET_ID, shipId: SHIP_ID });
  });

  it("keeps it when another ship's token, such as a flagship's, answers LEASE_ENDED", async () => {
    await watchManagementLease(fleet.door, store).whoami('aeolus_ct_v1_flagship');

    await expect(store.find()).resolves.toBeDefined();
  });

  it('keeps it while its calls succeed', async () => {
    fleet.state.liveTokens.add('aeolus_ct_v1_management');

    await watchManagementLease(fleet.door, store).whoami('aeolus_ct_v1_management');

    await expect(store.find()).resolves.toBeDefined();
  });
});
