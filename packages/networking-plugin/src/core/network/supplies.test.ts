import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore, memoryFleetNetworks } from '../../../test/support/connection-fakes.js';
import { memoryFleetSwitches } from '../../../test/support/memory-installation.js';
import { createConnect } from '../connection/connect.js';
import { createIsServed } from '../installation/served.js';
import { DEFAULT_DECLARATION } from './declaration.js';
import { createSupplies } from './supplies.js';
import { createSupplyFleet } from './supply-fleet.js';

const AT = new Date('2026-10-10T10:00:00.000Z');

let fleet: ReturnType<typeof fakePluginFleet>;
let networks: ReturnType<typeof memoryFleetNetworks>;
let supplies: ReturnType<typeof createSupplies>;

beforeEach(async () => {
  fleet = fakePluginFleet();
  const connections = memoryConnectionStore();
  networks = memoryFleetNetworks();
  const isServed = createIsServed({ installation: 'open', switches: memoryFleetSwitches() });
  supplies = createSupplies({ supplyFleet: createSupplyFleet({ door: fleet.door, connections, networks, isServed }) });
  await createConnect({ door: fleet.door, store: connections, clock: { now: () => AT } })({ operatorFleetId: FLEET_ID, shipId: SHIP_ID, secret: 'aeolus_sk_v1_good' });
});

describe('the supplies', () => {
  it('supply a fleet now, answering what was done', async () => {
    await expect(supplies.supply(FLEET_ID)).resolves.toBe('supplied');
    expect(fleet.state.plugin).toEqual(DEFAULT_DECLARATION);
  });

  it('keep a fleet the fleet refused as waiting, and supply it on the next retry once the fleet answers', async () => {
    fleet.state.isAnswering = false;

    await expect(supplies.supply(FLEET_ID)).resolves.toBe('waiting');
    fleet.state.isAnswering = true;
    await supplies.retry();

    expect(fleet.state.plugin).toEqual(DEFAULT_DECLARATION);
    await expect(supplies.retry()).resolves.toEqual([]);
  });

  it('retry no fleet that was supplied: nothing changes at the fleet', async () => {
    await supplies.supply(FLEET_ID);
    const version = fleet.state.version;

    await expect(supplies.retry()).resolves.toEqual([]);
    expect(fleet.state.version).toBe(version);
  });

  it('supply one fleet one change after another, so the list argo saved last is the one in force', async () => {
    const letGo = fleet.holdNextSet();
    const first = supplies.supply(FLEET_ID);
    const latest = [{ from: [], to: [] }];
    await networks.save(FLEET_ID, { rules: latest, declaration: DEFAULT_DECLARATION });
    const second = supplies.supply(FLEET_ID);

    letGo();
    await Promise.all([first, second]);

    expect(fleet.state.rules).toEqual(latest);
  });
});
