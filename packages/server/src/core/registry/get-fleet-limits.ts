import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { fleetLimitsOf, type FleetLimits } from './limits.js';
import type { FleetRepository, InstallationSettingsRepository } from './ports.js';

export interface GetFleetLimitsTx {
  fleets: FleetRepository;
  installationSettings: InstallationSettingsRepository;
}

export type GetFleetLimits = (input: { fleetId: FleetId }) => Promise<Result<FleetLimits, DomainError<'FLEET_NOT_FOUND'>>>;

/** Use case: a fleet's ship and daily message limits, how each is set and the limit that applies. */
export function createGetFleetLimits(deps: { uow: UnitOfWork<GetFleetLimitsTx> }): GetFleetLimits {
  return ({ fleetId }) =>
    deps.uow.run(async (tx): Promise<Result<FleetLimits, DomainError<'FLEET_NOT_FOUND'>>> => {
      const settings = await tx.fleets.limitSettings(fleetId);
      if (!settings) {
        return refuse('FLEET_NOT_FOUND', `The installation hosts no fleet ${fleetId}`);
      }
      return ok(fleetLimitsOf({ fleetId, settings, installation: await tx.installationSettings.read() }));
    });
}
