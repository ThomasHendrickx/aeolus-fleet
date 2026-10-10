import { connectedCrew, fakePluginFleet, memoryConnectionStore, memoryFleetNetworks } from './connection-fakes.js';
import { memoryFleetSwitches } from './memory-installation.js';
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
  await connectedCrew(fleet, connections);
  return { fleet, connections, networks, switches, supplies };
}
