import type { FleetId } from '@aeolus-fleet/common';

import type { OperatorAccountRepository } from '../identity/public.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { SecretHasher } from '../shared/secrets.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { installationRequestText } from './installation-request.js';
import type { FleetRepository, InstallationRequestRepository } from './ports.js';

export interface DeleteFleetTx {
  fleets: FleetRepository;
  operatorAccounts: OperatorAccountRepository;
  installationRequests: InstallationRequestRepository;
}

/**
 * The fleet a delete removed. The first time, with its name and operator
 * email: what the server logs, as no event survives it. A replay knows
 * neither, as nothing of the fleet is kept, and is not logged again.
 */
export type FleetDeleted = { fleetId: FleetId } & ({ isReplay: false; name: string; operatorEmail: string } | { isReplay: true });

export type DeleteFleetRefusal = DomainError<'FLEET_NOT_FOUND' | 'IDEMPOTENCY_KEY_REUSED'>;

export type DeleteFleet = (input: { requestId: string; fleetId: FleetId }) => Promise<Result<FleetDeleted, DeleteFleetRefusal>>;

/**
 * Use case: the installation deletes a fleet (docs/blueprint.md,
 * "Installation"), for good: every record in it goes in one unit of work,
 * which ends its console session and leases with it, and so does the request
 * that created it. No event is written, as the event log is the fleet's own.
 * Under its request id it runs once: the record keeps only the request's
 * hash, so a replay answers that the fleet was deleted, and another request
 * under that id is refused.
 */
export function createDeleteFleet(deps: { uow: UnitOfWork<DeleteFleetTx>; clock: Clock; hasher: SecretHasher }): DeleteFleet {
  return (input) =>
    deps.uow.run(async (tx): Promise<Result<FleetDeleted, DeleteFleetRefusal>> => {
      const { requestId, fleetId } = input;
      const requestHash = deps.hasher.hash(installationRequestText(['deleteFleet', fleetId]));
      await tx.installationRequests.lock(requestId);
      const earlier = await tx.installationRequests.find(requestId);
      if (earlier) {
        return earlier.kind === 'deleteFleet' && earlier.requestHash === requestHash
          ? ok({ isReplay: true, fleetId })
          : refuse('IDEMPOTENCY_KEY_REUSED', 'This request id was used for another request: use a new one for every request');
      }

      const fleet = await tx.fleets.findForUpdate(fleetId);
      if (!fleet) {
        return refuse('FLEET_NOT_FOUND', `The installation hosts no fleet ${fleetId}`);
      }
      const operatorEmail = (await tx.operatorAccounts.findForFleet(fleetId))?.email ?? '';
      await tx.fleets.delete(fleetId);
      await tx.installationRequests.record({ requestId, at: deps.clock.now(), requestHash, kind: 'deleteFleet' });
      return ok({ isReplay: false, fleetId, name: fleet.name, operatorEmail });
    });
}
