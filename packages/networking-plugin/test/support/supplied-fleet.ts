import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore, memoryFleetNetworks } from './connection-fakes.js';
import { memoryFleetSwitches } from './memory-installation.js';
import { createConnect } from '../../src/core/connection/connect.js';
import { createIsServed } from '../../src/core/installation/served.js';
import { createSupplies } from '../../src/core/network/supplies.js';
import { createSupplyFleet } from '../../src/core/network/supply-fleet.js';

/** A fake fleet the networking plugin is connected to and serves, with its supplies and its store of networks. */
export async function suppliedFleet() {
  const fleet = fakePluginFleet();
  const connections = memoryConnectionStore();
  const networks = memoryFleetNetworks();
  const isServed = createIsServed({ installation: 'open', switches: memoryFleetSwitches() });
  const supplies = createSupplies({ supplyFleet: createSupplyFleet({ door: fleet.door, connections, networks, isServed }) });
  const connected = await createConnect({ door: fleet.door, store: connections, clock: { now: () => new Date('2026-10-10T10:00:00.000Z') } })({
    operatorFleetId: FLEET_ID,
    shipId: SHIP_ID,
    secret: 'aeolus_sk_v1_good',
  });
  if (!connected.isOk) {
    throw new Error(`The fake fleet refused the connection: ${connected.error.message}`);
  }
  return { fleet, connections, networks, supplies };
}
