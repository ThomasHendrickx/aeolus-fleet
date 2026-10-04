import type { InstallationSettings } from './limits.js';
import type { InstallationSettingsRepository } from './ports.js';

export type GetInstallationSettings = () => Promise<InstallationSettings>;

/** Use case: the installation's default limits for its fleets and its cap on fleets; no limit for any it has not set. */
export function createGetInstallationSettings(deps: { settings: InstallationSettingsRepository }): GetInstallationSettings {
  return () => deps.settings.read();
}
