import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import { revokeShipSecret, type CredentialTx } from '../identity/public.js';
import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { giveBackCrewRequest, type GiveBackCrewRequestRefusal } from './crew-request.js';
import { endLease, type LeaseTx } from './leases.js';
import type { CrewRequestRepository, ShipRepository } from './ports.js';

export interface GiveBackCrewRequestTx extends LeaseTx, CredentialTx {
  ships: Pick<ShipRepository, 'findForUpdate'>;
  crewRequests: CrewRequestRepository;
  events: EventLog;
}

export type GiveBack = (
  caller: Caller,
  input: { shipId: ShipId; settingsVersion: number; reason: string },
) => Promise<Result<undefined, DomainError<'SHIP_NOT_FOUND'> | GiveBackCrewRequestRefusal>>;

/**
 * Use case: the trierarch a ship's crew request is assigned to gives it back
 * before its crew is final (#382), so the trierarch plugin places it on
 * another trierarch. Its scope (crew:run) is checked before this runs. In
 * one unit of work, locking the ship first: the request is unassigned and
 * the trierarch recorded, with CrewRequestGivenBack, and the lease its
 * registration holds ends as a release does, its secret invalidated, so the
 * ship awaits crew again. A refusal changes nothing.
 */
export function createGiveBackCrewRequest(deps: { uow: UnitOfWork<GiveBackCrewRequestTx>; clock: Clock; ids: IdGenerator }): GiveBack {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, DomainError<'SHIP_NOT_FOUND'> | GiveBackCrewRequestRefusal>> => {
      const { fleetId } = caller;
      const ship = await tx.ships.findForUpdate(fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const at = deps.clock.now();
      const actor = shipActor(caller.shipId);
      const given = giveBackCrewRequest(
        { ship, current: await tx.crewRequests.find(fleetId, ship.id), trierarchShipId: caller.shipId },
        { settingsVersion: input.settingsVersion, reason: input.reason, at, actor },
      );
      if (!given.isOk) {
        return given;
      }
      if (given.value.events.length === 0) {
        return ok(undefined);
      }
      await tx.crewRequests.save(given.value.request);
      for (const event of given.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      await revokeShipSecret({ tx, ids: deps.ids }, { fleetId, shipId: ship.id, actor, at });
      const lease = await tx.leases.findOpenForUpdate(fleetId, ship.id);
      if (lease) {
        await endLease({ tx, ids: deps.ids }, { fleetId, leaseId: lease.id, actor, at, reason: 'released' });
      }
      return ok(undefined);
    });
}
