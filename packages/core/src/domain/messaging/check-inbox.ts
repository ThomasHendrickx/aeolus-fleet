import { holdLease, type HoldLeaseTx, type LeaseEnded } from '../registry/public.js';
import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { inboxWait } from './inbox-wait.js';
import type { DeliveryRepository, ReceiverWakeups, ReceiverWatch } from './ports.js';

export interface CheckInboxTx extends HoldLeaseTx {
  deliveries: Pick<DeliveryRepository, 'countReceivable'>;
}

export type CheckInboxRefusal = DomainError<'INVALID_INBOX_WAIT' | 'SHIP_NOT_FOUND'> | LeaseEnded;

export type CheckInbox = (
  crew: Crew,
  input: { waitSeconds?: number },
) => Promise<Result<{ waiting: number }, CheckInboxRefusal>>;

/**
 * Use case: how many deliveries wait for the crew (`inbox`): what its next
 * receive would hand it, its own in flight and those pending for its ship or
 * its type. It claims nothing, so a watcher can ask as often as it likes and
 * leave every delivery for the receive. Its scope (messages:receive) is
 * checked before this runs.
 *
 * With a wait, and nothing waiting, it watches the same wake-ups as a
 * receive and looks again on each, until something waits or the wait has
 * passed. It starts watching before it looks a second time, so a delivery
 * that commits in between is counted.
 */
export function createCheckInbox(deps: {
  uow: UnitOfWork<CheckInboxTx>;
  clock: Clock;
  wakeups: ReceiverWakeups;
}): CheckInbox {
  return async (crew, input) => {
    const waitMs = inboxWait(input.waitSeconds);
    if (!waitMs.isOk) {
      return waitMs;
    }
    const until = deps.clock.now().getTime() + waitMs.value;
    let watch: ReceiverWatch | undefined;
    try {
      for (;;) {
        const look = await deps.uow.run(async (tx) => {
          const ship = await holdLease(tx, crew);
          if (!ship.isOk) {
            return ship;
          }
          const waiting = await tx.deliveries.countReceivable({
            fleetId: crew.fleetId,
            shipId: crew.shipId,
            type: ship.value.type,
            leaseId: crew.leaseId,
          });
          return ok({ type: ship.value.type, waiting });
        });
        if (!look.isOk) {
          return look;
        }
        const { type, waiting } = look.value;
        const remainingMs = until - deps.clock.now().getTime();
        if (waiting > 0 || remainingMs <= 0) {
          return ok({ waiting });
        }
        if (watch === undefined) {
          watch = deps.wakeups.watch({ fleetId: crew.fleetId, shipId: crew.shipId, type });
          continue;
        }
        if ((await watch.next(remainingMs)) === 'timedOut') {
          return ok({ waiting: 0 });
        }
      }
    } finally {
      watch?.stop();
    }
  };
}
