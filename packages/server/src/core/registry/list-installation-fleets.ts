import type { Clock } from '../shared/clock.js';
import { installationFleet, messageWindow, type InstallationFleet } from './installation-fleet.js';
import type { InstallationFleets, InstallationSettingsRepository } from './ports.js';

export type ListInstallationFleets = () => Promise<InstallationFleet[]>;

/**
 * Use case: every fleet the installation hosts, oldest first, with its
 * operator, its measures, its messages per UTC day of the last 7 days and the
 * limits that apply to it (docs/blueprint.md, "Installation"). It reads across
 * fleets, so only the installation token reaches it.
 */
export function createListInstallationFleets(deps: { fleets: InstallationFleets; settings: InstallationSettingsRepository; clock: Clock }): ListInstallationFleets {
  return async () => {
    const now = deps.clock.now();
    const installation = await deps.settings.read();
    return (await deps.fleets.list(messageWindow(now))).map((facts) => installationFleet(facts, { now, installation }));
  };
}
