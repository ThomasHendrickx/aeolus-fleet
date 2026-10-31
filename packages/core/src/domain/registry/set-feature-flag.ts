import type { FeatureFlag, FleetFeatureFlag, FleetId, IdGenerator } from '@aeolus-fleet/common';

import type { FleetSealingRepository } from '../messaging/public.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { fleetFeatureFlag, inUseNote, isInUse, type FeatureUse } from './feature-flag.js';
import type { FeatureFlagRepository, FleetRepository } from './ports.js';

export interface SetFeatureFlagTx {
  fleets: Pick<FleetRepository, 'findForUpdate'>;
  featureFlags: FeatureFlagRepository;
  sealings: Pick<FleetSealingRepository, 'find'>;
  events: EventLog;
}

export type SetFeatureFlagRefusal = DomainError<'FLEET_NOT_FOUND' | 'FEATURE_FLAG_IN_USE'>;

export type SetFeatureFlag = (input: { fleetId: FleetId; flag: FeatureFlag; isOn: boolean }) => Promise<Result<FleetFeatureFlag, SetFeatureFlagRefusal>>;

/**
 * Use case: the installation turns one feature flag on or off for one fleet
 * (decision 0069), writing FeatureFlagTurnedOn or FeatureFlagTurnedOff in the
 * same unit of work. A flag cannot go off while the fleet uses its feature:
 * refused FEATURE_FLAG_IN_USE with the flag list's line, changing nothing. The
 * fleet's row and the flag's are held, so two sets of one fleet's flags take
 * turns and a feature cannot come into use while its flag goes off. A flag set
 * to what it is answers as it is, and writes no event.
 */
export function createSetFeatureFlag(deps: { uow: UnitOfWork<SetFeatureFlagTx>; clock: Clock; ids: IdGenerator }): SetFeatureFlag {
  return ({ fleetId, flag, isOn }) =>
    deps.uow.run(async (tx): Promise<Result<FleetFeatureFlag, SetFeatureFlagRefusal>> => {
      if ((await tx.fleets.findForUpdate(fleetId)) === undefined) {
        return refuse('FLEET_NOT_FOUND', `The installation hosts no fleet ${fleetId}`);
      }
      const wasOn = await tx.featureFlags.isOnForUpdate(fleetId, flag);
      const use: FeatureUse = { isSealing: (await tx.sealings.find(fleetId)) !== undefined };
      if (wasOn === isOn) {
        return ok(fleetFeatureFlag(flag, { isOn, use }));
      }
      if (!isOn && isInUse(flag, use)) {
        return refuse('FEATURE_FLAG_IN_USE', inUseNote(flag));
      }
      if (isOn) {
        await tx.featureFlags.turnOn(fleetId, flag);
      } else {
        await tx.featureFlags.turnOff(fleetId, flag);
      }
      await recordEvent(
        { events: tx.events, ids: deps.ids },
        { fleetId, type: isOn ? 'FeatureFlagTurnedOn' : 'FeatureFlagTurnedOff', occurredAt: deps.clock.now(), actor: { kind: 'installation' }, details: { flag } },
      );
      return ok(fleetFeatureFlag(flag, { isOn, use }));
    });
}
