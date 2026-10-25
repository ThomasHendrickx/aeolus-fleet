import type { FleetId } from '@aeolus-fleet/common';

import { appliedLimitsOf, FOLLOWING_DEFAULTS, type AppliedLimits } from './limits.js';
import type { FleetRepository, InstallationSettingsRepository } from './ports.js';

export interface AppliedLimitsTx {
  fleets: Pick<FleetRepository, 'limitSettings'>;
  installationSettings: InstallationSettingsRepository;
}

/**
 * The limits that apply to the fleet now, in the caller's unit of work: its
 * own where it set one, else the installation's default; null where none
 * applies.
 */
export async function appliedLimits(tx: AppliedLimitsTx, fleetId: FleetId): Promise<AppliedLimits> {
  const settings = (await tx.fleets.limitSettings(fleetId)) ?? FOLLOWING_DEFAULTS;
  return appliedLimitsOf(settings, await tx.installationSettings.read());
}
