import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { installationFleet, messageWindow, type InstallationFleet } from './installation-fleet.js';
import type { InstallationFleets, InstallationSettingsRepository } from './ports.js';

export type GetInstallationFleet = (input: { fleetId: FleetId }) => Promise<Result<InstallationFleet, DomainError<'FLEET_NOT_FOUND'>>>;

/** Use case: one fleet of the installation, described as the list describes it. */
export function createGetInstallationFleet(deps: { fleets: InstallationFleets; settings: InstallationSettingsRepository; clock: Clock }): GetInstallationFleet {
  return async ({ fleetId }) => {
    const now = deps.clock.now();
    const facts = await deps.fleets.find(fleetId, messageWindow(now));
    return facts ? ok(installationFleet(facts, { now, installation: await deps.settings.read() })) : refuse('FLEET_NOT_FOUND', `The installation hosts no fleet ${fleetId}`);
  };
}
