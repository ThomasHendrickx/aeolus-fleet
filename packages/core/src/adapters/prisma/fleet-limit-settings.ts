import type { FleetLimitSetting, FleetLimitSettings, RetentionSetting } from '../../domain/registry/limits.js';
import type { Fleet } from './generated/client.js';

/** A fleet's limit columns: for each limit and the retention, whether the fleet sets its own and that limit or days (null for none). */
export type FleetLimitColumns = Pick<
  Fleet,
  | 'shipLimitSet'
  | 'shipLimit'
  | 'dailyMessageLimitSet'
  | 'dailyMessageLimit'
  | 'schedulesPerShipLimitSet'
  | 'schedulesPerShipLimit'
  | 'minimumScheduleIntervalSet'
  | 'minimumScheduleInterval'
  | 'retentionSet'
  | 'retentionDays'
>;

function settingOf(isSet: boolean, limit: number | null): FleetLimitSetting {
  return isSet ? { kind: 'fleet', limit } : { kind: 'default' };
}

function retentionOf(isSet: boolean, days: number | null): RetentionSetting {
  return isSet ? { kind: 'fleet', days } : { kind: 'default' };
}

/** How a fleet's limits and its retention are set, from its columns. */
export function limitSettingsOf(row: FleetLimitColumns): FleetLimitSettings {
  return {
    ships: settingOf(row.shipLimitSet, row.shipLimit),
    dailyMessages: settingOf(row.dailyMessageLimitSet, row.dailyMessageLimit),
    schedulesPerShip: settingOf(row.schedulesPerShipLimitSet, row.schedulesPerShipLimit),
    minimumScheduleInterval: settingOf(row.minimumScheduleIntervalSet, row.minimumScheduleInterval),
    retention: retentionOf(row.retentionSet, row.retentionDays),
  };
}
