import { holdLease, type HoldLeaseTx, type LeaseEnded } from '../registry/public.js';
import type { Crew } from '../shared/caller.js';
import type { DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { DeliveryRepository, ReceivableCount } from './ports.js';

export interface CheckInboxTx extends HoldLeaseTx {
  deliveries: Pick<DeliveryRepository, 'countReceivable'>;
}

export type CheckInboxRefusal = DomainError<'SHIP_NOT_FOUND'> | LeaseEnded;

export type CheckInbox = (crew: Crew) => Promise<Result<ReceivableCount, CheckInboxRefusal>>;

/**
 * Use case: how many deliveries wait for the crew (`inbox`): what its next
 * receive would hand it, its own in flight and those pending for its ship or
 * its type, and how many of those are forced and not handed over yet
 * (decision 0040), so a computer side knows to hand one over at once. It
 * claims nothing, so a watcher can ask as often as it likes and
 * leave every delivery for the receive. It answers at once: no call waits
 * (decision 0072); a crew is told to look by its wake stream. Its scope
 * (messages:receive) is checked before this runs.
 */
export function createCheckInbox(deps: { uow: UnitOfWork<CheckInboxTx> }): CheckInbox {
  return (crew) =>
    deps.uow.run(async (tx) => {
      const ship = await holdLease(tx, crew);
      if (!ship.isOk) {
        return ship;
      }
      return ok(
        await tx.deliveries.countReceivable({
          fleetId: crew.fleetId,
          shipId: crew.shipId,
          type: ship.value.type,
          leaseId: crew.leaseId,
        }),
      );
    });
}
