import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { installationFleet, messageWindowStart, type InstallationFleet } from './installation-fleet.js';
import type { InstallationFleets } from './ports.js';

export type GetInstallationFleet = (input: { fleetId: FleetId }) => Promise<Result<InstallationFleet, DomainError<'FLEET_NOT_FOUND'>>>;

/** Use case: one fleet of the installation, described as the list describes it. */
export function createGetInstallationFleet(deps: { fleets: InstallationFleets; clock: Clock }): GetInstallationFleet {
  return async ({ fleetId }) => {
    const facts = await deps.fleets.find(fleetId, messageWindowStart(deps.clock.now()));
    return facts ? ok(installationFleet(facts)) : refuse('FLEET_NOT_FOUND', `The installation hosts no fleet ${fleetId}`);
  };
}
