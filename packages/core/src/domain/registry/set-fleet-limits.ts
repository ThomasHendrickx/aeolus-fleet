import type { FleetId, IdGenerator } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, SYSTEM, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { fleetLimitsOf, limit, retentionDays, type FleetLimits, type FleetLimitSetting, type RetentionSetting } from './limits.js';
import type { FleetRepository, InstallationSettingsRepository } from './ports.js';

export interface SetFleetLimitsTx {
  fleets: FleetRepository;
  installationSettings: InstallationSettingsRepository;
  events: EventLog;
}

export type SetFleetLimitsRefusal = DomainError<'FLEET_NOT_FOUND' | 'INVALID_LIMIT' | 'INVALID_RETENTION'>;

export type SetFleetLimits = (input: {
  fleetId: FleetId;
  ships?: FleetLimitSetting;
  dailyMessages?: FleetLimitSetting;
  retention?: RetentionSetting;
}) => Promise<Result<FleetLimits, SetFleetLimitsRefusal>>;

/** A setting with its limit checked: the default, or a whole number of at least 0 or no limit. */
function validSetting(setting: FleetLimitSetting | undefined): Result<FleetLimitSetting | undefined, DomainError<'INVALID_LIMIT'>> {
  if (setting?.kind !== 'fleet') {
    return ok(setting);
  }
  const checked = limit(setting.limit);
  return checked.isOk ? ok({ kind: 'fleet', limit: checked.value }) : checked;
}

/** A retention setting with its days checked: the default, or a whole number of days of at least 1 or none. */
function validRetention(setting: RetentionSetting | undefined): Result<RetentionSetting | undefined, DomainError<'INVALID_RETENTION'>> {
  if (setting?.kind !== 'fleet') {
    return ok(setting);
  }
  const checked = retentionDays(setting.days);
  return checked.isOk ? ok({ kind: 'fleet', days: checked.value }) : checked;
}

/**
 * Use case: the installation sets any of a fleet's limits and its retention,
 * each to a number or to none for that fleet, or back to the installation
 * default. A setting left out keeps how it was set. Writes FleetLimitsChanged with the
 * settings the fleet now has, and answers which limits now apply.
 */
export function createSetFleetLimits(deps: { uow: UnitOfWork<SetFleetLimitsTx>; clock: Clock; ids: IdGenerator }): SetFleetLimits {
  return async (input) => {
    const ships = validSetting(input.ships);
    if (!ships.isOk) {
      return ships;
    }
    const dailyMessages = validSetting(input.dailyMessages);
    if (!dailyMessages.isOk) {
      return dailyMessages;
    }
    const retention = validRetention(input.retention);
    if (!retention.isOk) {
      return retention;
    }
    return deps.uow.run(async (tx): Promise<Result<FleetLimits, SetFleetLimitsRefusal>> => {
      const { fleetId } = input;
      const current = await tx.fleets.limitSettings(fleetId);
      if (!current) {
        return refuse('FLEET_NOT_FOUND', `The installation hosts no fleet ${fleetId}`);
      }
      const settings = {
        ships: ships.value ?? current.ships,
        dailyMessages: dailyMessages.value ?? current.dailyMessages,
        retention: retention.value ?? current.retention,
      };
      await tx.fleets.setLimitSettings(fleetId, settings);
      await recordEvent({ events: tx.events, ids: deps.ids }, {
        fleetId,
        type: 'FleetLimitsChanged',
        occurredAt: deps.clock.now(),
        actor: SYSTEM,
        // Event details are flat: each setting, and its own limit or days when set for the fleet.
        details: {
          ships: settings.ships.kind,
          shipLimit: settings.ships.kind === 'fleet' ? settings.ships.limit : null,
          dailyMessages: settings.dailyMessages.kind,
          dailyMessageLimit: settings.dailyMessages.kind === 'fleet' ? settings.dailyMessages.limit : null,
          retention: settings.retention.kind,
          retentionDays: settings.retention.kind === 'fleet' ? settings.retention.days : null,
        },
      });
      return ok(fleetLimitsOf({ fleetId, settings, installation: await tx.installationSettings.read() }));
    });
  };
}
