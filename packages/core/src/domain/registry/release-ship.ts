import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import { revokeShipSecret, type CredentialTx } from '../identity/public.js';
import type { ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { endLease, type LeaseTx } from './leases.js';
import { keepingReachRefusal, type NotReachable } from './check-reach.js';
import { checkManagedOrAssigned, type ManagedOrAssignedTx } from './managed-or-assigned.js';
import { endPluginConnection } from './plugin-connection.js';
import type { CrewRequestRepository, PluginConnectionRepository, ShipRepository } from './ports.js';
import { checkCanRelease, type ReleaseRefusal } from './ship.js';

export interface ReleaseShipTx extends LeaseTx, CredentialTx, Omit<ManagedOrAssignedTx, 'ships' | 'leases' | 'crewRequests'> {
  ships: ShipRepository;
  pluginConnections: PluginConnectionRepository;
  crewRequests: Pick<CrewRequestRepository, 'find'>;
}

export type ReleaseShipRefusal = DomainError<'SHIP_NOT_FOUND' | 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER'> | NotReachable | ReleaseRefusal;

export type ReleaseShip = (
  caller: ShipCaller,
  input: { shipId: ShipId },
) => Promise<Result<undefined, ReleaseShipRefusal>>;

/**
 * Use case: the caller releases a crewed ship of its fleet (Release): the
 * session crewing it loses it, and the ship awaits a new crew (ADR 0010). In
 * one unit of work: the secret is invalidated, the lease ends and with it the
 * crew token, and the deliveries the lease held in flight return to pending,
 * their attempts kept, and a plugin connection of the ship ends (decision
 * 0034). The next crew needs a new starting prompt. The caller's
 * scope (fleet:manage or crew:run) is checked before this runs;
 * crew:run reaches only the ships whose crew requests are assigned to the
 * caller's ship, and fleet:manage the ships in its manage reach (decision
 * 0034).
 *
 * Locks in the fleet's order: the ship, then its secret, then its lease. A
 * receive holding the lease makes the release wait, then the release returns
 * what the receive claimed. The lease is read last, like a new starting
 * prompt reads it, and a refusal rolls the revoked secret back.
 */
export function createReleaseShip(deps: {
  uow: UnitOfWork<ReleaseShipTx>;
  clock: Clock;
  ids: IdGenerator;
}): ReleaseShip {
  return (caller, { shipId }) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<undefined, ReleaseShipRefusal>> => {
      const { fleetId } = caller;
      const ship = await tx.ships.findForUpdate(fleetId, shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${shipId} does not exist`);
      }
      const at = deps.clock.now();
      const reaches = await checkManagedOrAssigned({ tx, ids: deps.ids }, { caller, ship, at });
      if (!reaches.isOk) {
        return reaches;
      }
      const actor = shipActor(caller.shipId);

      await revokeShipSecret({ tx, ids: deps.ids }, { fleetId, shipId, actor, at });
      const lease = checkCanRelease(ship, await tx.leases.findOpenForUpdate(fleetId, shipId));
      if (!lease.isOk) {
        return lease;
      }
      await endLease({ tx, ids: deps.ids }, { fleetId, leaseId: lease.value.id, actor, at, reason: 'released' });
      await endPluginConnection({ tx, ids: deps.ids }, { fleetId, shipId, why: 'released', at, actor });
      return ok(undefined);
    });
}
