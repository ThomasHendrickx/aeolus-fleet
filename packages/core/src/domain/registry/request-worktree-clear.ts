import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { requestWorktreeClear, type RequestWorktreeClearRefusal } from './clear-request.js';
import type { ClearRequestRepository, ShipRepository } from './ports.js';

export interface RequestWorktreeClearTx {
  ships: Pick<ShipRepository, 'find' | 'findForUpdate'>;
  clearRequests: ClearRequestRepository;
  events: EventLog;
}

export type RequestWorktreeClearUseCaseRefusal = DomainError<'SHIP_NOT_FOUND'> | RequestWorktreeClearRefusal;

export type RequestWorktreeClear = (
  caller: Caller,
  input: { trierarchShipId: ShipId; shipId: ShipId; repository: string },
) => Promise<Result<undefined, RequestWorktreeClearUseCaseRefusal>>;

/**
 * Use case: the caller asks a trierarch to clear the worktree it kept for a
 * ship in a repository (decision 0032). Its scope (fleet:manage) is checked
 * before this runs. In one unit of work, locking the trierarch ship first so
 * two requests never both pass its limit: the request and its event.
 */
export function createRequestWorktreeClear(deps: { uow: UnitOfWork<RequestWorktreeClearTx>; clock: Clock; ids: IdGenerator }): RequestWorktreeClear {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, RequestWorktreeClearUseCaseRefusal>> => {
      const { fleetId } = caller;
      const trierarch = await tx.ships.findForUpdate(fleetId, input.trierarchShipId);
      if (!trierarch) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.trierarchShipId} does not exist`);
      }
      if (!(await tx.ships.find(fleetId, input.shipId))) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const key = { trierarchShipId: trierarch.id, shipId: input.shipId, repository: input.repository };
      const requested = requestWorktreeClear(
        { trierarch, current: await tx.clearRequests.find(fleetId, key), pending: (await tx.clearRequests.listFor(fleetId, trierarch.id)).length },
        { shipId: input.shipId, repository: input.repository, requestedBy: caller.shipId, at: deps.clock.now(), actor: shipActor(caller.shipId) },
      );
      if (!requested.isOk) {
        return requested;
      }
      if (requested.value.request) {
        await tx.clearRequests.save(requested.value.request);
      }
      for (const event of requested.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
