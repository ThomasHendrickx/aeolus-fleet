import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/**
 * The installation's settings (docs/blueprint.md, "Installation"): the ship,
 * daily message and schedule limits and the retention a fleet follows unless
 * set for it, and the cap on the number of fleets. Null is no limit, and for
 * the retention kept for good. Aeolus sets none of its own: these are
 * whoever runs the installation's (decisions 0016, 0066).
 */
export interface InstallationSettings {
  defaultShipLimit: number | null;
  defaultDailyMessageLimit: number | null;
  /** The schedules a ship may hold active or paused (decision 0062, S12). */
  defaultSchedulesPerShipLimit: number | null;
  /** The shortest time between two send times of a repeating schedule, in seconds (decision 0062, S12). */
  defaultMinimumScheduleInterval: number | null;
  /** The days a fleet keeps its finished history (decision 0066). */
  defaultRetentionDays: number | null;
  fleetCap: number | null;
}

/** An installation that has set nothing: no limit anywhere and everything kept, as a self-hosted server runs. */
export const NO_INSTALLATION_SETTINGS: InstallationSettings = {
  defaultShipLimit: null,
  defaultDailyMessageLimit: null,
  defaultSchedulesPerShipLimit: null,
  defaultMinimumScheduleInterval: null,
  defaultRetentionDays: null,
  fleetCap: null,
};

/** How one of a fleet's limits is set: it follows the installation default, or is set for the fleet to a number or to no limit. */
export type FleetLimitSetting = { kind: 'default' } | { kind: 'fleet'; limit: number | null };

/** How a fleet's retention is set: it follows the installation default, or is set for the fleet to a number of days or to none (kept for good). */
export type RetentionSetting = { kind: 'default' } | { kind: 'fleet'; days: number | null };

/** How a fleet's limits and its retention are set. */
export interface FleetLimitSettings {
  ships: FleetLimitSetting;
  dailyMessages: FleetLimitSetting;
  schedulesPerShip: FleetLimitSetting;
  minimumScheduleInterval: FleetLimitSetting;
  retention: RetentionSetting;
}

/** A fleet that has set nothing for itself: every limit and the retention follow the installation default. */
export const FOLLOWING_DEFAULTS: FleetLimitSettings = {
  ships: { kind: 'default' },
  dailyMessages: { kind: 'default' },
  schedulesPerShip: { kind: 'default' },
  minimumScheduleInterval: { kind: 'default' },
  retention: { kind: 'default' },
};

/** One of a fleet's limits: how it is set, and the limit that applies (null: none). */
export interface FleetLimit {
  setting: FleetLimitSetting;
  applies: number | null;
}

/** A fleet's retention: how it is set, and the days that apply (null: kept for good). */
export interface FleetRetention {
  setting: RetentionSetting;
  applies: number | null;
}

export interface FleetLimits {
  fleetId: FleetId;
  ships: FleetLimit;
  dailyMessages: FleetLimit;
  schedulesPerShip: FleetLimit;
  minimumScheduleInterval: FleetLimit;
  retention: FleetRetention;
}

/** The limit that applies to the fleet now for each of its limits, and the retention in days; null where none applies. */
export type AppliedLimits = { [Name in keyof FleetLimitSettings]: number | null };

/** The limits a fleet applies from how it set them and the installation's defaults. */
export function appliedLimitsOf(settings: FleetLimitSettings, installation: InstallationSettings): AppliedLimits {
  return {
    ships: appliedLimit(settings.ships, installation.defaultShipLimit),
    dailyMessages: appliedLimit(settings.dailyMessages, installation.defaultDailyMessageLimit),
    schedulesPerShip: appliedLimit(settings.schedulesPerShip, installation.defaultSchedulesPerShipLimit),
    minimumScheduleInterval: appliedLimit(settings.minimumScheduleInterval, installation.defaultMinimumScheduleInterval),
    retention: appliedRetention(settings.retention, installation.defaultRetentionDays),
  };
}

/** A limit as configured: a whole number of at least 0, or null for no limit. */
export function limit(raw: number | null): Result<number | null, DomainError<'INVALID_LIMIT'>> {
  return raw === null || (Number.isInteger(raw) && raw >= 0) ? ok(raw) : refuse('INVALID_LIMIT', 'A limit is a whole number of at least 0, or none');
}

/** A retention as configured: a whole number of days of at least 1, or null for kept for good; no other minimum or maximum (decision 0066). */
export function retentionDays(raw: number | null): Result<number | null, DomainError<'INVALID_RETENTION'>> {
  return raw === null || (Number.isInteger(raw) && raw >= 1) ? ok(raw) : refuse('INVALID_RETENTION', 'A retention is a whole number of days of at least 1, or none');
}

/** The days a retention setting gives: its own when set for the fleet, else the installation default. */
export function appliedRetention(setting: RetentionSetting, defaultDays: number | null): number | null {
  return setting.kind === 'fleet' ? setting.days : defaultDays;
}

/** The limit a setting gives: its own when set for the fleet, else the installation default. */
export function appliedLimit(setting: FleetLimitSetting, defaultLimit: number | null): number | null {
  return setting.kind === 'fleet' ? setting.limit : defaultLimit;
}

/** A fleet's limits from how it set them and the installation's defaults. */
export function fleetLimitsOf(of: { fleetId: FleetId; settings: FleetLimitSettings; installation: InstallationSettings }): FleetLimits {
  const { fleetId, settings, installation } = of;
  const applies = appliedLimitsOf(settings, installation);
  return {
    fleetId,
    ships: { setting: settings.ships, applies: applies.ships },
    dailyMessages: { setting: settings.dailyMessages, applies: applies.dailyMessages },
    schedulesPerShip: { setting: settings.schedulesPerShip, applies: applies.schedulesPerShip },
    minimumScheduleInterval: { setting: settings.minimumScheduleInterval, applies: applies.minimumScheduleInterval },
    retention: { setting: settings.retention, applies: applies.retention },
  };
}
