import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { FleetRepository } from './ports.js';

export interface ReadFleetNameTx {
  fleets: Pick<FleetRepository, 'find'>;
}

export type ReadFleetName = (input: { fleetId: FleetId }) => Promise<Result<string, DomainError<'FLEET_NOT_FOUND'>>>;

/** Use case: a fleet's name, which every Aeolus app's header shows in its title (header design H8). */
export function createReadFleetName(deps: { uow: UnitOfWork<ReadFleetNameTx> }): ReadFleetName {
  return ({ fleetId }) =>
    deps.uow.run(async (tx): Promise<Result<string, DomainError<'FLEET_NOT_FOUND'>>> => {
      const fleet = await tx.fleets.find(fleetId);
      return fleet ? ok(fleet.name) : refuse('FLEET_NOT_FOUND', `The installation hosts no fleet ${fleetId}`);
    });
}
