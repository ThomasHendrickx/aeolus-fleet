import type { LabelValueId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, connectedCrew, fakePluginFleet, memoryConnectionStore, memoryFleetNetworks } from '../../../test/support/connection-fakes.js';
import { memoryFleetSwitches } from '../../../test/support/memory-installation.js';
import { createIsServed } from '../installation/served.js';
import { createSupplyFleet } from './supply-fleet.js';

const AT = new Date('2026-10-10T10:00:00.000Z');
const TEAM_A: LabelValueId = 'lbv_01m3tbfspe96yf1rnr4ank9001';
const TEAM_B: LabelValueId = 'lbv_01m3tbfspe96yf1rnr4ank9002';
const SQUADRONS: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9003';
const TRIERARCH_PLUGIN: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9004';

let fleet: ReturnType<typeof fakePluginFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;
let networks: ReturnType<typeof memoryFleetNetworks>;
let switches: ReturnType<typeof memoryFleetSwitches>;
let supplyFleet: ReturnType<typeof createSupplyFleet>;

beforeEach(async () => {
  fleet = fakePluginFleet();
  connections = memoryConnectionStore();
  networks = memoryFleetNetworks();
  switches = memoryFleetSwitches();
  await switches.set(FLEET_ID, { isEnabled: true, at: AT });
  supplyFleet = createSupplyFleet({ door: fleet.door, connections, networks, isServed: createIsServed({ installation: 'enabled', switches }) });
});

async function connected(): Promise<void> {
  await connectedCrew(fleet, connections);
}

describe('supplying a fleet the networking plugin serves', () => {
  it('registers with keep-latest and 300 seconds before argo declared anything, and supplies no rules: all-to-all', async () => {
    await connected();

    await expect(supplyFleet(FLEET_ID)).resolves.toEqual({ isOk: true, value: 'supplied' });
    expect(fleet.state.plugin).toEqual({ whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 300 });
    expect(fleet.state.rules).toBeNull();
  });

  it('registers with what argo declared, then supplies the whole list argo saved', async () => {
    await connected();
    const rules = [{ from: [TEAM_A], to: [TEAM_B] }, { from: [], to: [TEAM_A] }];
    await networks.save(FLEET_ID, { rules, declaration: { whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 } });

    await expect(supplyFleet(FLEET_ID)).resolves.toEqual({ isOk: true, value: 'supplied' });
    expect(fleet.state.plugin).toEqual({ whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 });
    expect(fleet.state.rules).toEqual(rules);
  });

  it('supplies an empty list as an empty list: only the fixed exceptions, not all-to-all', async () => {
    await connected();
    await networks.save(FLEET_ID, { rules: [], declaration: { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 300 } });

    await supplyFleet(FLEET_ID);

    expect(fleet.state.rules).toEqual([]);
  });

  it("adds every rule the fleet's ships declared to argo's list, after argo's (decision 0037)", async () => {
    await connected();
    const argos = [{ from: [TEAM_A], to: [TEAM_B] }];
    await networks.save(FLEET_ID, { rules: argos, declaration: { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 300 } });
    fleet.state.declared.push({ shipId: SQUADRONS, rules: [{ from: [TEAM_B], to: [TEAM_B] }] }, { shipId: TRIERARCH_PLUGIN, rules: [{ from: [], to: [TEAM_A] }] });

    await expect(supplyFleet(FLEET_ID)).resolves.toEqual({ isOk: true, value: 'supplied' });
    expect(fleet.state.rules).toEqual([...argos, { from: [TEAM_B], to: [TEAM_B] }, { from: [], to: [TEAM_A] }]);
  });

  it('adds declared rules to an empty list, which allows only the fixed exceptions', async () => {
    await connected();
    await networks.save(FLEET_ID, { rules: [], declaration: { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 300 } });
    fleet.state.declared.push({ shipId: SQUADRONS, rules: [{ from: [TEAM_B], to: [TEAM_B] }] });

    await supplyFleet(FLEET_ID);

    expect(fleet.state.rules).toEqual([{ from: [TEAM_B], to: [TEAM_B] }]);
  });

  it("keeps argo's none as none: rules only allow, so declared rules add nothing to all-to-all", async () => {
    await connected();
    fleet.state.declared.push({ shipId: SQUADRONS, rules: [{ from: [TEAM_B], to: [TEAM_B] }] });

    await supplyFleet(FLEET_ID);

    expect(fleet.state.rules).toBeNull();
  });

  it('supplies nothing to a fleet it is not connected to', async () => {
    await expect(supplyFleet(FLEET_ID)).resolves.toEqual({ isOk: true, value: 'not-connected' });
    expect(fleet.state.version).toBe(0);
  });

  it('is refused while the fleet does not answer, so it is supplied again later', async () => {
    await connected();
    fleet.state.isAnswering = false;

    await expect(supplyFleet(FLEET_ID)).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });

  it('drops a crew token the fleet no longer takes: not connected until argo connects it again', async () => {
    await connected();
    fleet.state.liveTokens.clear();

    await expect(supplyFleet(FLEET_ID)).resolves.toEqual({ isOk: true, value: 'not-connected' });
    await expect(connections.find(FLEET_ID)).resolves.toBeUndefined();
  });
});

describe('supplying a fleet the networking plugin does not serve (switched off)', () => {
  beforeEach(async () => {
    await connected();
    await supplyFleet(FLEET_ID);
    await networks.save(FLEET_ID, { rules: [{ from: [TEAM_A], to: [TEAM_B] }], declaration: { whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 } });
    await supplyFleet(FLEET_ID);
    await switches.set(FLEET_ID, { isEnabled: false, at: AT });
  });

  it('unregisters: no plugin and no rules, all-to-all, and keeps the rules it holds for when it is on again', async () => {
    await expect(supplyFleet(FLEET_ID)).resolves.toEqual({ isOk: true, value: 'unregistered' });
    expect(fleet.state.plugin).toBeNull();
    expect(fleet.state.rules).toBeNull();
    await expect(networks.find(FLEET_ID)).resolves.toMatchObject({ rules: [{ from: [TEAM_A], to: [TEAM_B] }] });
  });

  it('counts a fleet that says its ship is not the plugin as unregistered already', async () => {
    await supplyFleet(FLEET_ID);

    await expect(supplyFleet(FLEET_ID)).resolves.toEqual({ isOk: true, value: 'unregistered' });
  });

  it('registers again and supplies the kept rules once switched on again', async () => {
    await supplyFleet(FLEET_ID);
    await switches.set(FLEET_ID, { isEnabled: true, at: AT });

    await expect(supplyFleet(FLEET_ID)).resolves.toEqual({ isOk: true, value: 'supplied' });
    expect(fleet.state.plugin).toEqual({ whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 });
    expect(fleet.state.rules).toEqual([{ from: [TEAM_A], to: [TEAM_B] }]);
  });
});
