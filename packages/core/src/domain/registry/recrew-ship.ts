import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import { revokeShipSecret, type SecretTools } from '../identity/public.js';
import type { ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { endLease, type LeaseTx } from './leases.js';
import { checkManage, keepingReachRefusal, type CheckManageTx, type NotReachable } from './check-reach.js';
import { endPluginConnection } from './plugin-connection.js';
import type { ShipRepository } from './ports.js';
import type { ReleaseShipTx } from './release-ship.js';
import { checkCanRelease, type ReleaseRefusal } from './ship.js';
import { issueStartingPrompt, type IssuedStartingPrompt, type StartingPromptTx } from './starting-prompt.js';

export type RecrewShipTx = ReleaseShipTx & StartingPromptTx & LeaseTx & CheckManageTx & { ships: ShipRepository };

export type RecrewShipRefusal = DomainError<'SHIP_NOT_FOUND'> | NotReachable | ReleaseRefusal;

export type RecrewShip = (
  caller: ShipCaller,
  input: { shipId: ShipId },
) => Promise<Result<IssuedStartingPrompt, RecrewShipRefusal>>;

/**
 * Use case: a new crew for a crewed ship whose session is gone (Re-crew): a
 * release, then a new starting prompt, in one unit of work. No rule of its
 * own: the session crewing the ship loses it, its crew token and secret stop
 * working, what it held in flight returns to pending, and a new secret is
 * issued, shown once. Never half done: a refusal or a failure leaves the ship crewed as it was. The caller's scope
 * (fleet:manage) is checked before this runs.
 */
export function createRecrewShip(deps: {
  uow: UnitOfWork<RecrewShipTx>;
  clock: Clock;
  ids: IdGenerator;
  secrets: Omit<SecretTools, 'ids'>;
}): RecrewShip {
  return (caller, { shipId }) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<IssuedStartingPrompt, RecrewShipRefusal>> => {
      const { fleetId } = caller;
      const ship = await tx.ships.findForUpdate(fleetId, shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${shipId} does not exist`);
      }
      const managed = await checkManage({ tx, ids: deps.ids }, { fleetId: fleetId, managerShipId: caller.shipId, shipId: ship.id, at: deps.clock.now() });
      if (!managed.isOk) {
        return managed;
      }
      const actor = shipActor(caller.shipId);
      const at = deps.clock.now();

      await revokeShipSecret({ tx, ids: deps.ids }, { fleetId, shipId, actor, at });
      const lease = checkCanRelease(ship, await tx.leases.findOpenForUpdate(fleetId, shipId));
      if (!lease.isOk) {
        return lease;
      }
      await endLease({ tx, ids: deps.ids }, { fleetId, leaseId: lease.value.id, actor, at, reason: 'released' });
      await endPluginConnection({ tx, ids: deps.ids }, { fleetId, shipId: ship.id, why: 'released', at, actor });
      return ok(
        await issueStartingPrompt(
          { tx, secrets: { ...deps.secrets, ids: deps.ids } },
          { fleetId, shipId, actor, at },
        ),
      );
    });
}
