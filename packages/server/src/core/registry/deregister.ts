import type { IdGenerator } from '@aeolus-fleet/common';

import { revokeShipSecret, type CredentialTx } from '../identity/public.js';
import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { shipActor } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { refuseEndedLease, type LeaseEnded } from './lease.js';
import { endLease, type LeaseTx } from './leases.js';
import type { ShipRepository } from './ports.js';
import { checkCanDeregister } from './ship.js';

export interface DeregisterTx extends LeaseTx, CredentialTx {
  ships: ShipRepository;
}

export type DeregisterRefusal = DomainError<'OPERATOR_SHIP_IS_PERMANENT'> | LeaseEnded;

export type Deregister = (crew: Crew) => Promise<Result<undefined, DeregisterRefusal>>;

/**
 * Use case: a crew ends its own lease (`deregister`), and the ship awaits a new
 * crew. The same as a release, caused by the ship itself (ADR 0010): in one
 * unit of work the secret is invalidated, the lease ends and with it the crew
 * token, and the deliveries the lease held in flight return to pending, their
 * attempts kept. The ship and its inbox stay; the next crew needs a new
 * starting prompt. Needs only the crew token, no scope: a crew ends only its
 * own lease.
 *
 * Locks in the fleet's order, as a release does: the ship, then its secret,
 * then its lease. A refusal rolls the revoked secret back.
 */
export function createDeregister(deps: { uow: UnitOfWork<DeregisterTx>; clock: Clock; ids: IdGenerator }): Deregister {
  return (crew) =>
    deps.uow.run(async (tx): Promise<Result<undefined, DeregisterRefusal>> => {
      const { fleetId, shipId, leaseId } = crew;
      const ship = await tx.ships.findForUpdate(fleetId, shipId);
      if (!ship) {
        // A crew's ship always exists; the foreign key keeps the lease's ship in its fleet.
        return refuseEndedLease();
      }
      const actor = shipActor(shipId);
      const at = deps.clock.now();

      await revokeShipSecret({ tx, ids: deps.ids }, { fleetId, shipId, actor, at });
      const lease = checkCanDeregister(ship, { leaseId, heldLease: await tx.leases.findOpenForUpdate(fleetId, shipId) });
      if (!lease.isOk) {
        return lease;
      }
      await endLease({ tx, ids: deps.ids }, { fleetId, leaseId: lease.value.id, actor, at, reason: 'deregistered' });
      return ok(undefined);
    });
}
