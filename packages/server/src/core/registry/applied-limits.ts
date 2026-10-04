import type { FleetId } from '@aeolus-fleet/common';

import { appliedLimit, FOLLOWING_DEFAULTS } from './limits.js';
import type { FleetRepository, InstallationSettingsRepository } from './ports.js';

export interface AppliedLimitsTx {
  fleets: Pick<FleetRepository, 'limitSettings'>;
  installationSettings: InstallationSettingsRepository;
}

/**
 * The ship and daily message limits that apply to the fleet now, in the
 * caller's unit of work: its own where it set one, else the installation's
 * default; null where none applies.
 */
export async function appliedLimits(tx: AppliedLimitsTx, fleetId: FleetId): Promise<{ ships: number | null; dailyMessages: number | null }> {
  const settings = (await tx.fleets.limitSettings(fleetId)) ?? FOLLOWING_DEFAULTS;
  const installation = await tx.installationSettings.read();
  return {
    ships: appliedLimit(settings.ships, installation.defaultShipLimit),
    dailyMessages: appliedLimit(settings.dailyMessages, installation.defaultDailyMessageLimit),
  };
}
