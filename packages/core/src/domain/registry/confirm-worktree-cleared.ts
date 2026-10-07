import type { ClearOutcome, IdGenerator, ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { confirmWorktreeCleared, type ConfirmWorktreeClearedRefusal } from './clear-request.js';
import type { ClearRequestRepository, ShipRepository } from './ports.js';

export interface ConfirmWorktreeClearedTx {
  ships: Pick<ShipRepository, 'find' | 'findForUpdate'>;
  clearRequests: ClearRequestRepository;
  events: EventLog;
}

export type ConfirmWorktreeClearedUseCaseRefusal = DomainError<'SHIP_NOT_FOUND'> | ConfirmWorktreeClearedRefusal;

export type ConfirmWorktreeCleared = (
  caller: Caller,
  input: { shipId: ShipId; repository: string; outcome: ClearOutcome },
) => Promise<Result<undefined, ConfirmWorktreeClearedUseCaseRefusal>>;

/**
 * Use case: a trierarch confirms a clear request to its own ship, saying it
 * removed the worktree or kept none (decision 0032). Its scope (crew:run) is
 * checked before this runs. In one unit of work, locking its ship first: the
 * request goes, with WorktreeCleared.
 */
export function createConfirmWorktreeCleared(deps: { uow: UnitOfWork<ConfirmWorktreeClearedTx>; clock: Clock; ids: IdGenerator }): ConfirmWorktreeCleared {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, ConfirmWorktreeClearedUseCaseRefusal>> => {
      const { fleetId } = caller;
      const trierarch = await tx.ships.findForUpdate(fleetId, caller.shipId);
      if (!trierarch) {
        return refuse('SHIP_NOT_FOUND', `Ship ${caller.shipId} does not exist`);
      }
      const key = { trierarchShipId: trierarch.id, shipId: input.shipId, repository: input.repository };
      const confirmed = confirmWorktreeCleared(
        { trierarch, worktreeShipName: (await tx.ships.find(fleetId, input.shipId))?.name ?? input.shipId, current: await tx.clearRequests.find(fleetId, key) },
        { repository: input.repository, outcome: input.outcome, at: deps.clock.now(), actor: shipActor(caller.shipId) },
      );
      if (!confirmed.isOk) {
        return confirmed;
      }
      await tx.clearRequests.remove(fleetId, key);
      for (const event of confirmed.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
