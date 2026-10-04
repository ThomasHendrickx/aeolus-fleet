import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/**
 * The installation's settings (docs/blueprint.md, "Installation"): the ship
 * and daily message limits a fleet follows unless set for it, and the cap on
 * the number of fleets. Null is no limit. Aeolus sets none of its own: these
 * are whoever runs the installation's (decision 0016).
 */
export interface InstallationSettings {
  defaultShipLimit: number | null;
  defaultDailyMessageLimit: number | null;
  fleetCap: number | null;
}

/** An installation that has set nothing: no limit anywhere, as a self-hosted server runs. */
export const NO_INSTALLATION_SETTINGS: InstallationSettings = { defaultShipLimit: null, defaultDailyMessageLimit: null, fleetCap: null };

/** How one of a fleet's limits is set: it follows the installation default, or is set for the fleet to a number or to no limit. */
export type FleetLimitSetting = { kind: 'default' } | { kind: 'fleet'; limit: number | null };

/** How a fleet's ship and daily message limits are set. */
export interface FleetLimitSettings {
  ships: FleetLimitSetting;
  dailyMessages: FleetLimitSetting;
}

/** A fleet that has set nothing for itself: both limits follow the installation defaults. */
export const FOLLOWING_DEFAULTS: FleetLimitSettings = { ships: { kind: 'default' }, dailyMessages: { kind: 'default' } };

/** One of a fleet's limits: how it is set, and the limit that applies (null: none). */
export interface FleetLimit {
  setting: FleetLimitSetting;
  applies: number | null;
}

export interface FleetLimits {
  fleetId: FleetId;
  ships: FleetLimit;
  dailyMessages: FleetLimit;
}

/** A limit as configured: a whole number of at least 0, or null for no limit. */
export function limit(raw: number | null): Result<number | null, DomainError<'INVALID_LIMIT'>> {
  return raw === null || (Number.isInteger(raw) && raw >= 0) ? ok(raw) : refuse('INVALID_LIMIT', 'A limit is a whole number of at least 0, or none');
}

/** The limit a setting gives: its own when set for the fleet, else the installation default. */
export function appliedLimit(setting: FleetLimitSetting, defaultLimit: number | null): number | null {
  return setting.kind === 'fleet' ? setting.limit : defaultLimit;
}

/** A fleet's limits from how it set them and the installation's defaults. */
export function fleetLimitsOf(of: { fleetId: FleetId; settings: FleetLimitSettings; installation: InstallationSettings }): FleetLimits {
  const { fleetId, settings, installation } = of;
  return {
    fleetId,
    ships: { setting: settings.ships, applies: appliedLimit(settings.ships, installation.defaultShipLimit) },
    dailyMessages: { setting: settings.dailyMessages, applies: appliedLimit(settings.dailyMessages, installation.defaultDailyMessageLimit) },
  };
}
