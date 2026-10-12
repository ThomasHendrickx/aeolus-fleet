import type { DeliveryId, IdGenerator, MessageId, ShipId } from '@aeolus-fleet/common';

import { findShip, holdLease, isLeasePushed, type FindShipTx, type HoldLeaseTx, type LeaseEnded, type LeaseRepository, type Ship } from '../registry/public.js';
import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { Recipient } from '../shared/selector.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { handDelivery } from './delivery.js';
import type { Delivery, Message } from './message.js';
import type { DeliveryRepository, ReceiverWakeups, ReceiverWatch } from './ports.js';
import { receiveMax } from './receive-max.js';

export interface ReceiveDeliveriesTx extends HoldLeaseTx {
  leases: Pick<LeaseRepository, 'findOpenByIdForShare' | 'isPushed'>;
  deliveries: DeliveryRepository;
  events: EventLog;
}

/** One delivery handed to the crew, with its message. */
export interface ReceivedDelivery {
  deliveryId: DeliveryId;
  messageId: MessageId;
  senderShipId: ShipId;
  /** The sender's name and type as they are now, so the crew can answer it by name. */
  senderName: string;
  senderType: string;
  /** Who the delivery is for: the crew's ship, or its type. */
  recipient: Recipient;
  payload: string;
  contentType: string;
  /** The model the sender's session stated; none from argo. */
  model: string | null;
  inReplyTo: MessageId | null;
  sentAt: Date;
  /** How many times the delivery has been handed over, this time included: its attempts. */
  attempts: number;
}

export interface DeliveriesReceived {
  /** None when the wait ended without a delivery. */
  deliveries: ReceivedDelivery[];
}

export type ReceiveRefusal = DomainError<'INVALID_RECEIVE_MAX' | 'SHIP_NOT_FOUND'> | LeaseEnded;

export type ReceiveDeliveries = (
  crew: Crew,
  input: { max?: number },
) => Promise<Result<DeliveriesReceived, ReceiveRefusal>>;

/** How long a receive waits for a delivery when none is there: about 25 seconds, then it returns empty. */
export const RECEIVE_WAIT_MS = 25_000;

/**
 * The delivery as its crew gets it: with its message, and its sender by id
 * and by the name and type it has in Registry now.
 */
export async function receivedDeliveryOf(
  tx: FindShipTx,
  held: { delivery: Delivery; message: Message },
): Promise<Result<ReceivedDelivery, DomainError<'SHIP_NOT_FOUND'>>> {
  const { delivery, message } = held;
  const sender = await findShip(tx, { fleetId: delivery.fleetId, shipId: message.senderShipId });
  if (!sender.isOk) {
    // A message's sender always exists: ships are never deleted, and the foreign key keeps the sender in its fleet.
    return sender;
  }
  return ok({
    deliveryId: delivery.id,
    messageId: message.id,
    senderShipId: message.senderShipId,
    senderName: sender.value.name,
    senderType: sender.value.type,
    recipient: delivery.recipient,
    payload: message.payload,
    contentType: message.contentType,
    model: message.model,
    inReplyTo: message.inReplyToMessageId,
    sentAt: message.createdAt,
    attempts: delivery.attempts,
  });
}

interface ClaimDeps {
  tx: ReceiveDeliveriesTx;
  ids: IdGenerator;
  at: Date;
}

/**
 * Claims up to `max` deliveries for the crew in one unit of work: holds its
 * lease, then takes its own deliveries in flight, then the oldest pending ones
 * for its ship or its type. One that turns undeliverable is handed to no one,
 * and the next one claimable takes its place. Each one handed over names its
 * sender as Registry holds it now.
 */
async function claimForCrew(
  deps: ClaimDeps,
  claim: { crew: Crew; max: number },
): Promise<Result<{ ship: Ship; deliveries: ReceivedDelivery[] }, ReceiveRefusal>> {
  const { tx, ids, at } = deps;
  const { crew, max } = claim;
  const ship = await holdLease(tx, crew);
  if (!ship.isOk) {
    return ship;
  }
  if (await isLeasePushed(tx, crew)) {
    // The computer side takes a pushed lease's deliveries; the agent's own receive never gets one (decision 0040).
    return ok({ ship: ship.value, deliveries: [] });
  }

  const handedOut: ReceivedDelivery[] = [];
  const claimed: DeliveryId[] = [];
  let hasMore = true;
  while (hasMore && handedOut.length < max) {
    const limit = max - handedOut.length;
    const claimable = await tx.deliveries.findClaimableForUpdate({
      fleetId: crew.fleetId,
      shipId: crew.shipId,
      type: ship.value.type,
      leaseId: crew.leaseId,
      limit,
      excluding: claimed,
    });
    hasMore = claimable.length === limit;
    for (const { delivery, message } of claimable) {
      claimed.push(delivery.id);
      const { outcome, delivery: changed, events } = handDelivery(delivery, { crew, at });
      await tx.deliveries.update(changed);
      for (const event of events) {
        await recordEvent({ events: tx.events, ids }, event);
      }
      if (outcome === 'handed') {
        const received = await receivedDeliveryOf(tx, { delivery: changed, message });
        if (!received.isOk) {
          return received;
        }
        handedOut.push(received.value);
      }
    }
  }
  return ok({ ship: ship.value, deliveries: handedOut });
}

/**
 * Use case: a crew receives its deliveries (`receive`), up to `max`, 1 to 10,
 * one by default. Its scope (messages:receive) is checked before this runs.
 * Each attempt is one unit of work (see `claimForCrew`): every delivery it
 * returns is handed at once, in flight with the crew's ship and lease, until
 * the ship acknowledges it or the lease ends, and the crew's next receive
 * hands it again, counted as another attempt, so a lost reply loses nothing.
 * Its fifth attempt makes it undeliverable instead. Each delivery names its sender by id,
 * and by the name and type the sender has now, so the crew can answer by name.
 * On a pushed lease it hands nothing, its pending deliveries included: the
 * computer side takes them with a push receive (decision 0040).
 *
 * When nothing is there it waits, about 25 seconds, for a wake-up for its ship
 * or its type (ADR 0003: LISTEN/NOTIFY after commit), then returns empty. It
 * starts watching before it looks a second time, so a delivery that commits
 * between its first look and its watch is found by that second look. A
 * wake-up that brings nothing for it, a type delivery another ship took,
 * leaves it waiting for the rest of its time.
 */
export function createReceiveDeliveries(deps: {
  uow: UnitOfWork<ReceiveDeliveriesTx>;
  clock: Clock;
  ids: IdGenerator;
  wakeups: ReceiverWakeups;
  /** How long a receive waits on an empty inbox; about 25 seconds unless a test says otherwise. */
  waitMs?: number;
}): ReceiveDeliveries {
  const waitMs = deps.waitMs ?? RECEIVE_WAIT_MS;
  return async (crew, input) => {
    const max = receiveMax(input.max);
    if (!max.isOk) {
      return max;
    }

    return waitForDeliveries(
      { clock: deps.clock, wakeups: deps.wakeups, waitMs },
      { crew, look: () => deps.uow.run((tx) => claimForCrew({ tx, ids: deps.ids, at: deps.clock.now() }, { crew, max: max.value })) },
    );
  };
}

/**
 * Looks for the crew's deliveries, one unit of work per `look`, and
 * when there are none waits for a wake-up for its ship or its type, until
 * `waitMs` has passed. It starts watching before it looks a second time, so a
 * delivery that commits between its first look and its watch is found by that
 * second look. A wake-up that brings nothing for it leaves it waiting for the
 * rest of its time.
 */
export async function waitForDeliveries<Found, Refusal>(
  deps: { clock: Clock; wakeups: ReceiverWakeups; waitMs: number },
  wait: { crew: Crew; look: () => Promise<Result<{ ship: Ship; deliveries: Found[] }, Refusal>> },
): Promise<Result<{ deliveries: Found[] }, Refusal>> {
  const { crew, look } = wait;
  const until = deps.clock.now().getTime() + deps.waitMs;
  let watch: ReceiverWatch | undefined;
  try {
    for (;;) {
      const attempt = await look();
      if (!attempt.isOk) {
        return attempt;
      }
      const { ship, deliveries } = attempt.value;
      if (deliveries.length > 0) {
        return ok({ deliveries });
      }
      if (watch === undefined) {
        watch = deps.wakeups.watch({ fleetId: crew.fleetId, shipId: crew.shipId, type: ship.type });
        continue;
      }
      const remainingMs = until - deps.clock.now().getTime();
      if (remainingMs <= 0 || (await watch.next(remainingMs)) === 'timedOut') {
        return ok({ deliveries: [] });
      }
    }
  } finally {
    watch?.stop();
  }
}
