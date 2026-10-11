import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryManagementStore, SHIP_ID } from '../../../test/support/management-fakes.js';
import { memoryFleetSwitches, memoryInstallationRequests, plainHasher } from '../../../test/support/memory-installation.js';
import { fakeNetworkFleet } from '../../../test/support/network-fakes.js';
import { createWithdrawNetworkRules } from '../network/withdraw-network-rules.js';
import { createSetFleetEnabled } from './set-fleet-enabled.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const AT = new Date('2026-10-04T12:00:00.000Z');

let switches: ReturnType<typeof memoryFleetSwitches>;
let requests: ReturnType<typeof memoryInstallationRequests>;
let setEnabled: ReturnType<typeof createSetFleetEnabled>;
let fleet: ReturnType<typeof fakeNetworkFleet>;

beforeEach(async () => {
  switches = memoryFleetSwitches();
  requests = memoryInstallationRequests();
  fleet = fakeNetworkFleet(new Set(['aeolus_ct_v1_squadrons']));
  const management = memoryManagementStore();
  await management.save({ fleetId: FLEET, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_squadrons', crewedAt: AT });
  const withdraw = createWithdrawNetworkRules({ door: fleet.door, management, declarations: new Map() });
  setEnabled = createSetFleetEnabled({ switches, requests, hasher: plainHasher, clock: { now: () => AT }, withdraw });
});

describe("switching a fleet's squadrons on or off", () => {
  it('turns it on, and off again', async () => {
    await expect(setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: true })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET, isEnabled: true } });
    expect(switches.held.get(FLEET)).toBe(true);

    await expect(setEnabled({ requestId: 'r-2', fleetId: FLEET, isEnabled: false })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET, isEnabled: false } });
    expect(switches.held.get(FLEET)).toBe(false);
  });

  it('answers a replayed request id with its first answer, and changes nothing again', async () => {
    await setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: true });
    await setEnabled({ requestId: 'r-2', fleetId: FLEET, isEnabled: false });

    await expect(setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: true })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET, isEnabled: true } });
    expect(switches.held.get(FLEET)).toBe(false);
  });

  it('refuses a request id used for another request', async () => {
    await setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: true });

    await expect(setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: false })).resolves.toMatchObject({ isOk: false, error: { kind: 'REQUEST_ID_USED' } });
    expect(switches.held.get(FLEET)).toBe(true);
  });

  it('withdraws its declared network rules from the fleet when switched off (#573)', async () => {
    await setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: false });

    expect(fleet.state.declarations).toEqual([[]]);
  });

  it('withdraws nothing when switched on', async () => {
    await setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: true });

    expect(fleet.state.declarations).toEqual([]);
  });

  it('switches off while the fleet does not answer, keeping the switch for a later pass to withdraw', async () => {
    fleet.state.isAnswering = false;

    await expect(setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: false })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET, isEnabled: false } });
    expect(switches.held.get(FLEET)).toBe(false);
    expect(fleet.state.declarations).toEqual([]);
  });
});
