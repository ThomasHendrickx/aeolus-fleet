import type { Clock } from '../shared/clock.js';
import { readHealthOf } from '../shared/health-read.js';
import type { HealthSnapshots } from '../shared/health-snapshot.js';
import type { HealthRecords } from '../shared/health.js';
import { installationFleet, messageWindow, type InstallationFleet } from './installation-fleet.js';
import type { InstallationFleets, InstallationSettingsRepository } from './ports.js';

export type ListInstallationFleets = () => Promise<InstallationFleet[]>;

/**
 * Use case: every fleet the installation hosts, oldest first, with its
 * operator, its measures, its messages per UTC day of the last 7 days and the
 * limits that apply to it and its health (docs/blueprint.md, "Installation").
 * It reads across fleets, so only the installation token reaches it.
 */
export function createListInstallationFleets(deps: {
  fleets: InstallationFleets;
  settings: InstallationSettingsRepository;
  health: HealthRecords;
  snapshots: HealthSnapshots;
  clock: Clock;
}): ListInstallationFleets {
  return async () => {
    const now = deps.clock.now();
    const installation = await deps.settings.read();
    const fleets = await deps.fleets.list(messageWindow(now));
    return Promise.all(fleets.map(async (facts) => installationFleet(facts, { now, installation, health: await readHealthOf({ records: deps.health, snapshots: deps.snapshots }, { fleetId: facts.fleetId, now }) })));
  };
}
