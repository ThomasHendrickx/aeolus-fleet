import type { FleetLimitSetting, FleetLimitSettings } from '../../domain/registry/limits.js';
import type { Fleet } from './generated/client.js';

/** A fleet's limit columns: for each limit, whether the fleet sets its own and that limit (null for no limit). */
export type FleetLimitColumns = Pick<
  Fleet,
  'shipLimitSet' | 'shipLimit' | 'dailyMessageLimitSet' | 'dailyMessageLimit' | 'schedulesPerShipLimitSet' | 'schedulesPerShipLimit' | 'minimumScheduleIntervalSet' | 'minimumScheduleInterval'
>;

function settingOf(isSet: boolean, limit: number | null): FleetLimitSetting {
  return isSet ? { kind: 'fleet', limit } : { kind: 'default' };
}

/** How a fleet's limits are set, from its columns. */
export function limitSettingsOf(row: FleetLimitColumns): FleetLimitSettings {
  return {
    ships: settingOf(row.shipLimitSet, row.shipLimit),
    dailyMessages: settingOf(row.dailyMessageLimitSet, row.dailyMessageLimit),
    schedulesPerShip: settingOf(row.schedulesPerShipLimitSet, row.schedulesPerShipLimit),
    minimumScheduleInterval: settingOf(row.minimumScheduleIntervalSet, row.minimumScheduleInterval),
  };
}
