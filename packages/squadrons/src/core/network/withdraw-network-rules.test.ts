import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, memoryManagementStore } from '../../../test/support/management-fakes.js';
import { fakeNetworkFleet } from '../../../test/support/network-fakes.js';
import type { Declarations } from './ports.js';
import { createWithdrawNetworkRules } from './withdraw-network-rules.js';

const AT = new Date('2026-10-11T12:00:00.000Z');
const CREW_TOKEN = 'aeolus_ct_v1_squadrons';

let fleet: ReturnType<typeof fakeNetworkFleet>;
let declarations: Declarations;
let withdraw: ReturnType<typeof createWithdrawNetworkRules>;

beforeEach(async () => {
  fleet = fakeNetworkFleet(new Set([CREW_TOKEN]));
  const management = memoryManagementStore();
  await management.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: CREW_TOKEN, crewedAt: AT });
  declarations = new Map();
  withdraw = createWithdrawNetworkRules({ door: fleet.door, management, declarations });
});

describe('squadrons withdrawing its declared network rules', () => {
  it('declares an empty list, which withdraws them (#573)', async () => {
    await expect(withdraw(FLEET_ID)).resolves.toEqual({ isOk: true, value: { isWithdrawn: true } });

    expect(fleet.state.declarations).toEqual([[]]);
  });

  it('withdraws once in this process, until it declares again', async () => {
    await withdraw(FLEET_ID);

    await expect(withdraw(FLEET_ID)).resolves.toEqual({ isOk: true, value: { isWithdrawn: false } });
    expect(fleet.state.declarations).toEqual([[]]);
  });

  it('has nothing to withdraw from a fleet it is not connected to', async () => {
    await expect(withdraw(OTHER_FLEET_ID)).resolves.toEqual({ isOk: true, value: { isWithdrawn: false } });

    expect(fleet.state.declarations).toEqual([]);
  });

  it('has nothing to withdraw once its ship was released: retiring it takes the rules', async () => {
    fleet.state.liveTokens.clear();

    await expect(withdraw(FLEET_ID)).resolves.toEqual({ isOk: true, value: { isWithdrawn: false } });
  });

  it('is refused while the fleet does not answer, to withdraw again later', async () => {
    fleet.state.isAnswering = false;

    await expect(withdraw(FLEET_ID)).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    fleet.state.isAnswering = true;
    await expect(withdraw(FLEET_ID)).resolves.toEqual({ isOk: true, value: { isWithdrawn: true } });
  });
});
