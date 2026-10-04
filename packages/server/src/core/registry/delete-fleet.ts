import type { FleetId } from '@aeolus-fleet/common';

import type { OperatorAccountRepository } from '../identity/public.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { FleetRepository, InstallationRequestRepository } from './ports.js';

export interface DeleteFleetTx {
  fleets: FleetRepository;
  operatorAccounts: OperatorAccountRepository;
  installationRequests: InstallationRequestRepository;
}

/** The fleet that was deleted, by name and operator email: what the server logs, as no event survives it. */
export interface FleetDeleted {
  fleetId: FleetId;
  name: string;
  operatorEmail: string;
}

export type DeleteFleetRefusal = DomainError<'FLEET_NOT_FOUND' | 'IDEMPOTENCY_KEY_REUSED'>;

export type DeleteFleet = (input: { requestId: string; fleetId: FleetId }) => Promise<Result<FleetDeleted, DeleteFleetRefusal>>;

/**
 * Use case: the installation deletes a fleet (docs/blueprint.md,
 * "Installation"), for good: every record in it goes in one unit of work,
 * which ends its console session and leases with it. No event is written, as
 * the event log is the fleet's own; the adapter logs the delete. Under its
 * request id it runs once: a replay answers the same though the fleet is gone,
 * and another request under that id is refused.
 */
export function createDeleteFleet(deps: { uow: UnitOfWork<DeleteFleetTx>; clock: Clock }): DeleteFleet {
  return (input) =>
    deps.uow.run(async (tx): Promise<Result<FleetDeleted, DeleteFleetRefusal>> => {
      const { requestId, fleetId } = input;
      await tx.installationRequests.lock(requestId);
      const earlier = await tx.installationRequests.find(requestId);
      if (earlier) {
        return earlier.kind === 'deleteFleet' && earlier.fleetId === fleetId
          ? ok({ fleetId, name: earlier.name, operatorEmail: earlier.operatorEmail })
          : refuse('IDEMPOTENCY_KEY_REUSED', 'This request id was used for another request: use a new one for every request');
      }

      const fleet = await tx.fleets.findForUpdate(fleetId);
      if (!fleet) {
        return refuse('FLEET_NOT_FOUND', `The installation hosts no fleet ${fleetId}`);
      }
      const operatorEmail = (await tx.operatorAccounts.findForFleet(fleetId))?.email ?? '';
      await tx.fleets.delete(fleetId);
      await tx.installationRequests.record({ requestId, at: deps.clock.now(), kind: 'deleteFleet', fleetId, name: fleet.name, operatorEmail });
      return ok({ fleetId, name: fleet.name, operatorEmail });
    });
}
