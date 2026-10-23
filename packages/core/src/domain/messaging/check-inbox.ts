import { holdLease, type HoldLeaseTx, type LeaseEnded } from '../registry/public.js';
import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import type { FleetEventWakeups, FleetNewsWatch } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { inboxWait } from './inbox-wait.js';
import type { DeliveryRepository, ReceivableCount, ReceiverWakeups, ReceiverWatch } from './ports.js';

export interface CheckInboxTx extends HoldLeaseTx {
  deliveries: Pick<DeliveryRepository, 'countReceivable'>;
}

export type CheckInboxRefusal = DomainError<'INVALID_INBOX_WAIT' | 'SHIP_NOT_FOUND'> | LeaseEnded;

export type CheckInbox = (
  crew: Crew,
  input: { waitSeconds?: number; knownWaiting?: number },
) => Promise<Result<ReceivableCount, CheckInboxRefusal>>;

/**
 * Use case: how many deliveries wait for the crew (`inbox`): what its next
 * receive would hand it, its own in flight and those pending for its ship or
 * its type, and how many of those are forced and not handed over yet
 * (decision 0040), so a computer side knows to hand one over at once. It
 * claims nothing, so a watcher can ask as often as it likes and
 * leave every delivery for the receive. Its scope (messages:receive) is
 * checked before this runs.
 *
 * With a wait, it waits while the count is still the one the crew knows, or
 * none when it knows none, and looks again on each wake-up, until the count
 * differs or the wait has passed; it then answers the count of its last look.
 * It starts watching before it looks a second time, so a change that commits
 * in between is counted. Without a known count only a delivery pending for
 * the ship or its type can end the wait, so it watches those; with one the
 * count may also fall (an ack, a return, another ship of its type claiming),
 * and every such change commits with its event, so it watches the fleet's
 * events.
 */
export function createCheckInbox(deps: {
  uow: UnitOfWork<CheckInboxTx>;
  clock: Clock;
  wakeups: ReceiverWakeups;
  fleetNews: FleetEventWakeups;
}): CheckInbox {
  return async (crew, input) => {
    const waitMs = inboxWait(input.waitSeconds);
    if (!waitMs.isOk) {
      return waitMs;
    }
    const knownWaiting = input.knownWaiting ?? 0;
    const until = deps.clock.now().getTime() + waitMs.value;
    let watch: ReceiverWatch | FleetNewsWatch | undefined;
    try {
      for (;;) {
        const look = await deps.uow.run(async (tx) => {
          const ship = await holdLease(tx, crew);
          if (!ship.isOk) {
            return ship;
          }
          const count = await tx.deliveries.countReceivable({
            fleetId: crew.fleetId,
            shipId: crew.shipId,
            type: ship.value.type,
            leaseId: crew.leaseId,
          });
          return ok({ type: ship.value.type, count });
        });
        if (!look.isOk) {
          return look;
        }
        const { type, count } = look.value;
        const remainingMs = until - deps.clock.now().getTime();
        if (count.waiting !== knownWaiting || remainingMs <= 0) {
          return ok(count);
        }
        if (watch === undefined) {
          watch =
            input.knownWaiting === undefined
              ? deps.wakeups.watch({ fleetId: crew.fleetId, shipId: crew.shipId, type })
              : deps.fleetNews.watch(crew.fleetId);
          continue;
        }
        if ((await watch.next(remainingMs)) === 'timedOut') {
          return ok(count);
        }
      }
    } finally {
      watch?.stop();
    }
  };
}
