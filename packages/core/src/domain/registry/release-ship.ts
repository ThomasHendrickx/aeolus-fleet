import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import { revokeShipSecret, type CredentialTx } from '../identity/public.js';
import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { endLease, type LeaseTx } from './leases.js';
import { checkReaches } from './crew-request.js';
import type { CrewRequestRepository, ShipRepository } from './ports.js';
import { checkCanRelease, type ReleaseRefusal } from './ship.js';

export interface ReleaseShipTx extends LeaseTx, CredentialTx {
  ships: ShipRepository;
  crewRequests: Pick<CrewRequestRepository, 'find'>;
}

export type ReleaseShipRefusal = DomainError<'SHIP_NOT_FOUND' | 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER'> | ReleaseRefusal;

/** The scopes that release every ship; crew:run releases only the ships assigned to the caller's ship. */
const RELEASE_SCOPES = ['fleet:manage', 'fleet:crew'] as const;

export type ReleaseShip = (
  caller: Caller,
  input: { shipId: ShipId },
) => Promise<Result<undefined, ReleaseShipRefusal>>;

/**
 * Use case: the caller releases a crewed ship of its fleet (Release): the
 * session crewing it loses it, and the ship awaits a new crew (ADR 0010). In
 * one unit of work: the secret is invalidated, the lease ends and with it the
 * crew token, and the deliveries the lease held in flight return to pending,
 * their attempts kept. The next crew needs a new starting prompt. The caller's
 * scope (fleet:manage, fleet:crew or crew:run) is checked before this runs;
 * crew:run reaches only the ships whose crew requests are assigned to the
 * caller's ship.
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
    deps.uow.run(async (tx): Promise<Result<undefined, ReleaseShipRefusal>> => {
      const { fleetId } = caller;
      const ship = await tx.ships.findForUpdate(fleetId, shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${shipId} does not exist`);
      }
      const reaches = checkReaches(caller, { ship, current: await tx.crewRequests.find(fleetId, shipId), broadScopes: RELEASE_SCOPES });
      if (!reaches.isOk) {
        return reaches;
      }
      const actor = shipActor(caller.shipId);
      const at = deps.clock.now();

      await revokeShipSecret({ tx, ids: deps.ids }, { fleetId, shipId, actor, at });
      const lease = checkCanRelease(ship, await tx.leases.findOpenForUpdate(fleetId, shipId));
      if (!lease.isOk) {
        return lease;
      }
      await endLease({ tx, ids: deps.ids }, { fleetId, leaseId: lease.value.id, actor, at, reason: 'released' });
      return ok(undefined);
    });
}
