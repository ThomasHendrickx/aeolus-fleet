import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore, memoryFleetNetworks } from './connection-fakes.js';
import { memoryFleetSwitches } from './memory-installation.js';
import { createConnect } from '../../src/core/connection/connect.js';
import type { InstallationMode } from '../../src/core/installation/ports.js';
import { createIsServed } from '../../src/core/installation/served.js';
import { createSupplies } from '../../src/core/network/supplies.js';
import { createSupplyFleet } from '../../src/core/network/supply-fleet.js';

/**
 * A fake fleet the networking plugin is connected to, with its supplies, its
 * store of networks and its switches. Open, the installation serves it; enabled,
 * it is served once switched on.
 */
export async function suppliedFleet(installation: InstallationMode = 'open') {
  const fleet = fakePluginFleet();
  const connections = memoryConnectionStore();
  const networks = memoryFleetNetworks();
  const switches = memoryFleetSwitches();
  const isServed = createIsServed({ installation, switches });
  const supplies = createSupplies({ supplyFleet: createSupplyFleet({ door: fleet.door, connections, networks, isServed }) });
  const connected = await createConnect({ door: fleet.door, store: connections, clock: { now: () => new Date('2026-10-10T10:00:00.000Z') } })({
    operatorFleetId: FLEET_ID,
    shipId: SHIP_ID,
    secret: 'aeolus_sk_v1_good',
  });
  if (!connected.isOk) {
    throw new Error(`The fake fleet refused the connection: ${connected.error.message}`);
  }
  return { fleet, connections, networks, switches, supplies };
}
