import type { FleetId, IdGenerator } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { SYSTEM } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { endLease, type LeaseTx } from './leases.js';
import { findOperatorShip, type ShipTx } from './ships.js';

export interface EndLeasesAfterRestoreTx extends LeaseTx, ShipTx {}

export type EndLeasesAfterRestore = (input: {
  fleetId: FleetId;
}) => Promise<Result<{ endedLeases: number }, DomainError<'FLEET_NOT_FOUND'>>>;

/**
 * Use case: `fleet:restored`, run once after a restore (docs/design/
 * self-hosting-operations.md, section 5). A lease that ended after the backup
 * is open again in the restored database, held by a session that is gone, and
 * nothing ends it by itself (decision 0010). This ends every open lease of the
 * fleet but argo's, in one unit of work, each as `endLease` does, with the
 * reason `restored`: its deliveries in flight return to pending, and a session
 * still holding its crew token is answered LEASE_ENDED. A server command: the
 * system is the actor. It changes nothing else.
 */
export function createEndLeasesAfterRestore(deps: {
  uow: UnitOfWork<EndLeasesAfterRestoreTx>;
  clock: Clock;
  ids: IdGenerator;
}): EndLeasesAfterRestore {
  return ({ fleetId }) =>
    deps.uow.run(async (tx): ReturnType<EndLeasesAfterRestore> => {
      const argo = await findOperatorShip(tx, fleetId);
      if (!argo.isOk) {
        return argo;
      }
      const at = deps.clock.now();
      let endedLeases = 0;
      for (const lease of await tx.leases.listOpen(fleetId)) {
        if (lease.shipId !== argo.value.id && (await endLease({ tx, ids: deps.ids }, { fleetId, leaseId: lease.id, actor: SYSTEM, at, reason: 'restored' }))) {
          endedLeases += 1;
        }
      }
      return ok({ endedLeases });
    });
}
