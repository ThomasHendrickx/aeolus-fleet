/**
 * The 10 and 60 minute clocks of a pushed ship (#586, decision 0040). The
 * fleet runs them from the states and the turn the computer side reports, so
 * a computer that died leaves the source of truth true. argo is told once per
 * lease and oldest delivery whose clock ran out.
 */
import type { DeliveryId, FleetId, LeaseId, MessageId, ShipId, TurnState } from '@aeolus-fleet/common';

import { SYSTEM, type NewEvent } from '../shared/events.js';

const MINUTE_MS = 60_000;

/** A delivery handed and not confirmed this long is overdue, whatever the turn. */
export const NOT_CONFIRMED_MINUTES = 10;

/** A delivery waiting this long while the session is idle is overdue. */
export const IDLE_MINUTES = 10;

/** A delivery waiting this long while the session is busy is overdue. */
export const BUSY_MINUTES = 60;

/** Which clock ran out: handed and not confirmed, or waiting while idle or busy. */
export type OverdueClock = 'notConfirmed' | 'idle' | 'busy';

/** The states a delivery waits in for a pushed ship: pending for it, or in flight with its lease. */
export type WaitingState = 'pending' | 'received' | 'handed';

/** A delivery waiting for a pushed crew, and since when it is in its state. */
export interface WaitingDelivery {
  deliveryId: DeliveryId;
  messageId: MessageId;
  state: WaitingState;
  /** When it entered its state: stored, returned, received, or handed with its latest hand-over number. */
  since: Date;
  /** When its message was sent: the oldest waiting is told first. */
  sentAt: Date;
}

/** An open pushed lease, with its turn and the deliveries waiting for it. */
export interface PushedCrew {
  fleetId: FleetId;
  shipId: ShipId;
  leaseId: LeaseId;
  pushedAt: Date;
  /** Whether its ship is a person's: a person away is not stuck, so its clocks never run (interop 5.1). */
  isPerson: boolean;
  /** The ship's owner now (decision 0045): DeliveryOverdue names it, so the watch tells it as well as argo (decision 0040). Null for a ship no ship owns. */
  ownerShipId: ShipId | null;
  /** The turn its hooks last reported, since when; null before the first report. */
  turn: { state: TurnState; at: Date } | null;
  waiting: WaitingDelivery[];
}

/** A delivery whose clock ran out on a pushed crew's lease. */
export interface Overdue {
  fleetId: FleetId;
  shipId: ShipId;
  ownerShipId: ShipId | null;
  leaseId: LeaseId;
  delivery: WaitingDelivery;
  clock: OverdueClock;
  minutes: number;
}

/**
 * The crew's oldest waiting delivery whose clock ran out, if any. A handed
 * delivery runs the 10 minute clock from its hand-over. A pending or received
 * one runs 10 minutes while the session is idle and 60 while it is busy,
 * counted from the latest of its state, the turn and the lease's push: a
 * lease with no turn reported is idle since it was pushed.
 */
export function overdueDelivery(crew: PushedCrew, now: Date): Overdue | undefined {
  if (crew.isPerson) {
    return undefined;
  }
  const oldestFirst = crew.waiting.toSorted((first, second) => first.sentAt.getTime() - second.sentAt.getTime() || first.deliveryId.localeCompare(second.deliveryId));
  for (const delivery of oldestFirst) {
    const { clock, minutes, from } = clockOf(delivery, crew);
    if (now.getTime() - from.getTime() >= minutes * MINUTE_MS) {
      return { fleetId: crew.fleetId, shipId: crew.shipId, ownerShipId: crew.ownerShipId, leaseId: crew.leaseId, delivery, clock, minutes };
    }
  }
  return undefined;
}

/** A pushed crew as its clocks read it: the turn its hooks last reported, and since when its lease is pushed. */
export type ClockedCrew = Pick<PushedCrew, 'turn' | 'pushedAt'>;

/** Whether the clock of a delivery waiting for a pushed crew ran out at `now`, by the rule `overdueDelivery` tells by. */
export function hasClockRunOut(delivery: Pick<WaitingDelivery, 'state' | 'since'>, read: { crew: ClockedCrew; now: Date }): boolean {
  const { minutes, from } = clockOf(delivery, read.crew);
  return read.now.getTime() - from.getTime() >= minutes * MINUTE_MS;
}

function clockOf(delivery: Pick<WaitingDelivery, 'state' | 'since'>, crew: ClockedCrew): { clock: OverdueClock; minutes: number; from: Date } {
  const turn: { state: TurnState; at: Date } = crew.turn ?? { state: 'idle', at: crew.pushedAt };
  if (delivery.state === 'handed') {
    return { clock: 'notConfirmed', minutes: NOT_CONFIRMED_MINUTES, from: delivery.since };
  }
  const from = new Date(Math.max(delivery.since.getTime(), turn.at.getTime(), crew.pushedAt.getTime()));
  switch (turn.state) {
    case 'idle':
      return { clock: 'idle', minutes: IDLE_MINUTES, from };
    case 'busy':
      return { clock: 'busy', minutes: BUSY_MINUTES, from };
  }
}

/** DeliveryOverdue: the fleet told argo, as the system, that the delivery's clock ran out, naming the ship's owner now. */
export function overdueEvent(overdue: Overdue, at: Date): NewEvent {
  return {
    fleetId: overdue.fleetId,
    type: 'DeliveryOverdue',
    occurredAt: at,
    actor: SYSTEM,
    shipId: overdue.shipId,
    messageId: overdue.delivery.messageId,
    deliveryId: overdue.delivery.deliveryId,
    details: { leaseId: overdue.leaseId, clock: overdue.clock, minutes: overdue.minutes, ownerShipId: overdue.ownerShipId },
  };
}
