import type { Clock } from '../shared/clock.js';
import { installationFleet, messageWindowStart, type InstallationFleet } from './installation-fleet.js';
import type { InstallationFleets } from './ports.js';

export type ListInstallationFleets = () => Promise<InstallationFleet[]>;

/**
 * Use case: every fleet the installation hosts, oldest first, with its
 * operator, its ships that are not retired, the messages stored in the last 7
 * days and its last activity (docs/blueprint.md, "Installation"). It reads
 * across fleets, so only the installation token reaches it.
 */
export function createListInstallationFleets(deps: { fleets: InstallationFleets; clock: Clock }): ListInstallationFleets {
  return async () => (await deps.fleets.list(messageWindowStart(deps.clock.now()))).map(installationFleet);
}
