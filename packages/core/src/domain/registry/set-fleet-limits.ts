import type { FleetId, IdGenerator } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, SYSTEM, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { fleetLimitsOf, limit, type FleetLimits, type FleetLimitSetting } from './limits.js';
import type { FleetRepository, InstallationSettingsRepository } from './ports.js';

export interface SetFleetLimitsTx {
  fleets: FleetRepository;
  installationSettings: InstallationSettingsRepository;
  events: EventLog;
}

export type SetFleetLimitsRefusal = DomainError<'FLEET_NOT_FOUND' | 'INVALID_LIMIT'>;

export type SetFleetLimits = (input: {
  fleetId: FleetId;
  ships?: FleetLimitSetting;
  dailyMessages?: FleetLimitSetting;
}) => Promise<Result<FleetLimits, SetFleetLimitsRefusal>>;

/** A setting with its limit checked: the default, or a whole number of at least 0 or no limit. */
function validSetting(setting: FleetLimitSetting | undefined): Result<FleetLimitSetting | undefined, DomainError<'INVALID_LIMIT'>> {
  if (setting?.kind !== 'fleet') {
    return ok(setting);
  }
  const checked = limit(setting.limit);
  return checked.isOk ? ok({ kind: 'fleet', limit: checked.value }) : checked;
}

/**
 * Use case: the installation sets one or both of a fleet's limits, each to a
 * number or to no limit for that fleet, or back to the installation default.
 * A limit left out keeps how it was set. Writes FleetLimitsChanged with the
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
    return deps.uow.run(async (tx): Promise<Result<FleetLimits, SetFleetLimitsRefusal>> => {
      const { fleetId } = input;
      const current = await tx.fleets.limitSettings(fleetId);
      if (!current) {
        return refuse('FLEET_NOT_FOUND', `The installation hosts no fleet ${fleetId}`);
      }
      const settings = { ships: ships.value ?? current.ships, dailyMessages: dailyMessages.value ?? current.dailyMessages };
      await tx.fleets.setLimitSettings(fleetId, settings);
      await recordEvent({ events: tx.events, ids: deps.ids }, {
        fleetId,
        type: 'FleetLimitsChanged',
        occurredAt: deps.clock.now(),
        actor: SYSTEM,
        // Event details are flat: each limit's setting, and its own limit when set for the fleet.
        details: {
          ships: settings.ships.kind,
          shipLimit: settings.ships.kind === 'fleet' ? settings.ships.limit : null,
          dailyMessages: settings.dailyMessages.kind,
          dailyMessageLimit: settings.dailyMessages.kind === 'fleet' ? settings.dailyMessages.limit : null,
        },
      });
      return ok(fleetLimitsOf({ fleetId, settings, installation: await tx.installationSettings.read() }));
    });
  };
}
