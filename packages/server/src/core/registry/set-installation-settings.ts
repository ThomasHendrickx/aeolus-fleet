import type { DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { limit, type InstallationSettings } from './limits.js';
import type { InstallationSettingsRepository } from './ports.js';

export interface SetInstallationSettingsTx {
  installationSettings: InstallationSettingsRepository;
}

export type SetInstallationSettings = (input: InstallationSettings) => Promise<Result<InstallationSettings, DomainError<'INVALID_LIMIT'>>>;

/**
 * Use case: the installation sets its default ship and daily message limits
 * for fleets and its cap on fleets, each a number or no limit. A change to a
 * default applies at once to every fleet that follows it. No fleet's event
 * log holds it: the installation's settings belong to no fleet.
 */
export function createSetInstallationSettings(deps: { uow: UnitOfWork<SetInstallationSettingsTx> }): SetInstallationSettings {
  return async (input) => {
    const defaultShipLimit = limit(input.defaultShipLimit);
    const defaultDailyMessageLimit = limit(input.defaultDailyMessageLimit);
    const fleetCap = limit(input.fleetCap);
    if (!defaultShipLimit.isOk) {
      return defaultShipLimit;
    }
    if (!defaultDailyMessageLimit.isOk) {
      return defaultDailyMessageLimit;
    }
    if (!fleetCap.isOk) {
      return fleetCap;
    }
    const settings = { defaultShipLimit: defaultShipLimit.value, defaultDailyMessageLimit: defaultDailyMessageLimit.value, fleetCap: fleetCap.value };
    await deps.uow.run(async (tx) => {
      await tx.installationSettings.write(settings);
      return ok(undefined);
    });
    return ok(settings);
  };
}
