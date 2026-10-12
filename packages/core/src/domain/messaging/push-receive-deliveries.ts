import type { IdGenerator } from '@aeolus-fleet/common';

import { holdLease, markLeasePushed, type HoldLeaseTx, type LeaseRepository, type Ship } from '../registry/public.js';
import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { pushReceiveDelivery } from './delivery.js';
import type { DeliveryRepository, ReceiverWakeups } from './ports.js';
import {
  RECEIVE_WAIT_MS,
  receivedDeliveryOf,
  waitForDeliveries,
  type ReceivedDelivery,
  type ReceiveRefusal,
} from './receive-deliveries.js';
import { receiveMax } from './receive-max.js';

export interface PushReceiveDeliveriesTx extends HoldLeaseTx {
  leases: Pick<LeaseRepository, 'findOpenByIdForShare' | 'markPushed'>;
  deliveries: DeliveryRepository;
  events: EventLog;
}

/** One delivery a push receive took, as the computer side keeps it: where it stands, and its last hand-over number. */
export interface PushReceivedDelivery extends ReceivedDelivery {
  /** Received: not yet handed to the agent. Handed: handed already, its hand-over number reported. */
  state: 'received' | 'handed';
  /** The last hand-over number the crew reported; none while received, or when a plain receive handed it. */
  handOverNumber: number | null;
}

export interface DeliveriesPushReceived {
  /** None when the wait ended without a delivery. */
  deliveries: PushReceivedDelivery[];
}

export type PushReceiveDeliveries = (
  crew: Crew,
  input: { max?: number },
) => Promise<Result<DeliveriesPushReceived, ReceiveRefusal>>;

interface PushReceiptDeps {
  tx: PushReceiveDeliveriesTx;
  ids: IdGenerator;
  at: Date;
}

/**
 * Takes up to `max` deliveries for the crew in one unit of work: marks its
 * lease pushed (LeasePushed the first time), holds it, then takes its own in
 * flight, received or handed,
 * and then the oldest pending for its ship or its type, each received.
 */
async function pushReceiptForCrew(
  deps: PushReceiptDeps,
  receipt: { crew: Crew; max: number },
): Promise<Result<{ ship: Ship; deliveries: PushReceivedDelivery[] }, ReceiveRefusal>> {
  const { tx, ids, at } = deps;
  const { crew, max } = receipt;
  await markLeasePushed({ tx, ids }, { fleetId: crew.fleetId, shipId: crew.shipId, leaseId: crew.leaseId, at });
  const ship = await holdLease(tx, crew);
  if (!ship.isOk) {
    return ship;
  }

  const taken = await tx.deliveries.findClaimableForUpdate({
    fleetId: crew.fleetId,
    shipId: crew.shipId,
    type: ship.value.type,
    leaseId: crew.leaseId,
    limit: max,
    excluding: [],
  });
  const received: PushReceivedDelivery[] = [];
  for (const { delivery, message } of taken) {
    const { delivery: changed, events } = pushReceiveDelivery(delivery, { crew, at });
    await tx.deliveries.update(changed);
    for (const event of events) {
      await recordEvent({ events: tx.events, ids }, event);
    }
    const handedOut = await receivedDeliveryOf(tx, { delivery: changed, message });
    if (!handedOut.isOk) {
      return handedOut;
    }
    received.push({
      ...handedOut.value,
      state: changed.state === 'handed' ? 'handed' : 'received',
      handOverNumber: changed.handOverNumber,
    });
  }
  return ok({ ship: ship.value, deliveries: received });
}

/**
 * Use case: the crew's computer side, the trierarch or the plugin watcher,
 * receives for the agent (`pushReceive`, decision 0040), up to `max`, 1 to
 * 10, one by default. Its scope (messages:receive) is checked before this
 * runs. Each look is one unit of work (see `pushReceiptForCrew`). A pending
 * delivery becomes received, in flight with the crew's ship and lease, and
 * counts no attempt; the computer side reports handed once it hands it to
 * the agent. Its own in flight comes again first, changing nothing, so a
 * restart or a lost answer loses nothing. From its first push receive until
 * it ends, the lease is pushed: the agent's plain receive answers nothing.
 * When nothing is there it waits as a receive does, about 25 seconds.
 */
export function createPushReceiveDeliveries(deps: {
  uow: UnitOfWork<PushReceiveDeliveriesTx>;
  clock: Clock;
  ids: IdGenerator;
  wakeups: ReceiverWakeups;
  /** How long a push receive waits on an empty inbox; about 25 seconds unless a test says otherwise. */
  waitMs?: number;
}): PushReceiveDeliveries {
  const waitMs = deps.waitMs ?? RECEIVE_WAIT_MS;
  return async (crew, input) => {
    const max = receiveMax(input.max);
    if (!max.isOk) {
      return max;
    }
    return waitForDeliveries(
      { clock: deps.clock, wakeups: deps.wakeups, waitMs },
      { crew, look: () => deps.uow.run((tx) => pushReceiptForCrew({ tx, ids: deps.ids, at: deps.clock.now() }, { crew, max: max.value })) },
    );
  };
}
