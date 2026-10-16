import { isPingContentType, type LeaseId, type MessageId, type ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor, type NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { Delivery, Message } from './message.js';

/**
 * The Delivery's rules once it is stored (docs/blueprint.md, "Key flows"): a
 * plain receive hands it over at once, a push receive takes it for the
 * computer side to hand over, the ship it was handed to acknowledges it,
 * and a delivery that keeps being handed over without an acknowledgement
 * stops, undeliverable, where the operator sees it.
 */

/**
 * The attempt at which a delivery never acknowledged becomes undeliverable
 * instead of being handed over again: the fifth. A poison message stops there
 * rather than looping forever.
 */
export const UNDELIVERABLE_AT_ATTEMPT = 5;

/** The crew a receive or an ack comes from: its ship and the lease it crews it under. */
export interface CrewOfShip {
  shipId: ShipId;
  leaseId: LeaseId;
}

export interface DeliveryHandOver {
  /** Handed: to the crew. Undeliverable: this was the fifth attempt, so it is handed to no one. */
  outcome: 'handed' | 'undeliverable';
  delivery: Delivery;
  events: NewEvent[];
}

/**
 * Counts one attempt at handing the delivery to the crew: the fifth makes it
 * undeliverable and hands it to no one; before that, it is handed, in flight
 * with the crew's ship and lease. A hand-over by a push receive's crew keeps
 * its number. Either change is caused by the receiving ship.
 */
function countAttempt(delivery: Delivery, attempt: { crew: CrewOfShip; at: Date; handOverNumber: number | null }): DeliveryHandOver {
  const { crew, at, handOverNumber } = attempt;
  const attempts = delivery.attempts + 1;
  const concerns = {
    fleetId: delivery.fleetId,
    occurredAt: at,
    actor: shipActor(crew.shipId),
    shipId: crew.shipId,
    messageId: delivery.messageId,
    deliveryId: delivery.id,
    details: { leaseId: crew.leaseId, attempts, ...(handOverNumber !== null && { handOverNumber }) },
  };

  if (attempts >= UNDELIVERABLE_AT_ATTEMPT) {
    return {
      outcome: 'undeliverable',
      delivery: { ...delivery, state: 'undeliverable', claimedByShipId: null, claimedByLeaseId: null, attempts, handOverNumber },
      events: [{ ...concerns, type: 'DeliveryUndeliverable' }],
    };
  }
  return {
    outcome: 'handed',
    delivery: { ...delivery, state: 'handed', claimedByShipId: crew.shipId, claimedByLeaseId: crew.leaseId, attempts, handOverNumber },
    events: [{ ...concerns, type: 'DeliveryHanded' }],
  };
}

/**
 * A plain receive hands a crew a delivery it may take at once: one pending
 * for its ship or its type, or one of its own handed, again after a lost
 * reply. Every plain receive is one attempt (see `countAttempt`).
 */
export function handDelivery(delivery: Delivery, handOver: { crew: CrewOfShip; at: Date }): DeliveryHandOver {
  return countAttempt(delivery, { ...handOver, handOverNumber: null });
}

/**
 * A push receive takes a delivery for the crew's computer side, which hands
 * it to the agent later (decision 0040). A pending one becomes received, in
 * flight with the crew's ship and lease, with no attempt counted and no
 * hand-over number yet. One of the crew's own in flight, received or handed,
 * is received again: nothing changes, and DeliveryReceived marked again says
 * so. The repository returns nothing else to a push receive.
 */
export function pushReceiveDelivery(
  delivery: Delivery,
  receipt: { crew: CrewOfShip; at: Date },
): { delivery: Delivery; events: NewEvent[] } {
  const { crew, at } = receipt;
  const isAgain = delivery.state !== 'pending';
  const event: NewEvent = {
    fleetId: delivery.fleetId,
    type: 'DeliveryReceived',
    occurredAt: at,
    actor: shipActor(crew.shipId),
    shipId: crew.shipId,
    messageId: delivery.messageId,
    deliveryId: delivery.id,
    details: { leaseId: crew.leaseId, ...(isAgain && { again: true }) },
  };
  return isAgain
    ? { delivery, events: [event] }
    : {
        delivery: { ...delivery, state: 'received', claimedByShipId: crew.shipId, claimedByLeaseId: crew.leaseId, handOverNumber: null },
        events: [event],
      };
}

export type HandOverRefusal = DomainError<
  'DELIVERY_NOT_IN_FLIGHT' | 'DELIVERY_HELD_BY_ANOTHER_SHIP' | 'DELIVERY_NOT_ACKNOWLEDGED' | 'DELIVERY_HANDED_ONCE_MORE'
>;

/** Where a delivery stands after handed: handed to the agent, acknowledged already, or undeliverable at the fifth attempt. */
export type HandedState = 'handed' | 'acknowledged' | 'undeliverable';

/** A hand-over its crew reports: the number, and whether it hands a confirmed message once more after its turn died. */
export interface HandOver {
  crew: CrewOfShip;
  handOverNumber: number;
  isOnceMore: boolean;
  at: Date;
}

/**
 * The crew's computer side reports it handed a delivery to the agent, with
 * its hand-over number (decision 0040). A higher number than the last is a
 * new hand-over and counts one attempt; the fifth is undeliverable and
 * nothing is handed. The same number again, or a lower one, is a lost
 * answer: OK, and nothing changes, also once the agent acknowledged it. Only
 * the crew holding the delivery hands it over; one that is not in flight is
 * refused. Handed once more is its own rule (see `handOnceMore`).
 */
export function handOverDelivery(
  delivery: Delivery,
  handOver: HandOver,
): Result<{ state: HandedState; delivery: Delivery; events: NewEvent[] }, HandOverRefusal> {
  const { crew, handOverNumber, at } = handOver;
  const isRepeat = delivery.handOverNumber !== null && handOverNumber <= delivery.handOverNumber;
  switch (delivery.state) {
    case 'received':
    case 'handed':
    case 'acknowledged': {
      if (delivery.claimedByLeaseId !== crew.leaseId) {
        return refuse(
          'DELIVERY_HELD_BY_ANOTHER_SHIP',
          `Delivery ${delivery.id} is held by another ship: only the crew that received it hands it over`,
        );
      }
      if (handOver.isOnceMore) {
        return handOnceMore(delivery, handOver);
      }
      if (delivery.state !== 'received' && isRepeat) {
        return ok({ state: delivery.state, delivery, events: [] });
      }
      if (delivery.state === 'acknowledged') {
        return refuse(
          'DELIVERY_NOT_IN_FLIGHT',
          `Delivery ${delivery.id} is acknowledged, not in flight: its agent confirmed it, so hand it only once more, after its turn died`,
        );
      }
      const { outcome, delivery: changed, events } = countAttempt(delivery, { crew, at, handOverNumber });
      return ok({ state: outcome, delivery: changed, events });
    }
    case 'pending':
    case 'handled':
    case 'notHandled':
    case 'undeliverable':
    case 'dismissed':
    case 'abandoned':
      return refuse(
        'DELIVERY_NOT_IN_FLIGHT',
        `Delivery ${delivery.id} is ${delivery.state}, not in flight: hand over a delivery once a push receive took it`,
      );
  }
}

/**
 * A confirmed message whose turn or session died is handed once more, the
 * one retry (decision 0040). The fleet's promise ended at the ack, so it stays
 * acknowledged and counts no attempt; DeliveryHanded marked once more records
 * it. Its repeat, at the same or a lower number, is a lost answer: OK, and
 * nothing changes. A second once more is refused: if that turn dies too, the
 * message is not handled. Only an acknowledged delivery is handed once more.
 */
function handOnceMore(
  delivery: Delivery,
  handOver: HandOver,
): Result<{ state: HandedState; delivery: Delivery; events: NewEvent[] }, HandOverRefusal> {
  const { crew, handOverNumber, at } = handOver;
  if (delivery.state !== 'acknowledged') {
    return refuse(
      'DELIVERY_NOT_ACKNOWLEDGED',
      `Delivery ${delivery.id} is ${delivery.state}, not acknowledged: only a confirmed message is handed once more`,
    );
  }
  if (delivery.handedOnceMoreAt !== null) {
    return delivery.handOverNumber !== null && handOverNumber <= delivery.handOverNumber
      ? ok({ state: delivery.state, delivery, events: [] })
      : refuse(
          'DELIVERY_HANDED_ONCE_MORE',
          `Delivery ${delivery.id} was handed once more already: if that turn died too, report it not handled`,
        );
  }
  return ok({
    state: delivery.state,
    delivery: { ...delivery, handOverNumber, handedOnceMoreAt: at },
    events: [
      {
        fleetId: delivery.fleetId,
        type: 'DeliveryHanded',
        occurredAt: at,
        actor: shipActor(crew.shipId),
        shipId: crew.shipId,
        messageId: delivery.messageId,
        deliveryId: delivery.id,
        details: { leaseId: crew.leaseId, attempts: delivery.attempts, handOverNumber, onceMore: true },
      },
    ],
  });
}

export type TurnEndRefusal = DomainError<
  'DELIVERY_NOT_IN_FLIGHT' | 'DELIVERY_HELD_BY_ANOTHER_SHIP' | 'DELIVERY_NOT_ACKNOWLEDGED' | 'DELIVERY_NOT_HANDED_ONCE_MORE'
>;

/** How the turn that took a confirmed message ended: by itself (handled), or died a second time (not handled). */
export type TurnEnd = 'handled' | 'notHandled';

/**
 * A pushed crew reports how the turn that took an acknowledged delivery
 * ended (decision 0040): handled when it ended by itself, not handled when
 * the turn it was handed once more to died too. Either writes its event,
 * DeliveryHandled or DeliveryNotHandled, and keeps who it was handed to;
 * the reason the crew gave goes with the event (#847).
 * The same report again is harmless: OK, and nothing changes. A delivery not
 * acknowledged yet, or that ended the other way, is refused, so a ping not
 * answered with pong stays handed. Not handled needs the once more first.
 * Only the crew holding the delivery reports it.
 */
export function endTurn(
  delivery: Delivery,
  report: { crew: CrewOfShip; end: TurnEnd; at: Date; reason?: string },
): Result<{ delivery: Delivery; events: NewEvent[] }, TurnEndRefusal> {
  const { crew, end, at, reason } = report;
  switch (delivery.state) {
    case 'received':
    case 'handed':
    case 'acknowledged':
    case 'handled':
    case 'notHandled': {
      if (delivery.claimedByLeaseId !== crew.leaseId) {
        return refuse(
          'DELIVERY_HELD_BY_ANOTHER_SHIP',
          `Delivery ${delivery.id} is held by another ship: only the crew it was handed to reports its turn`,
        );
      }
      if (delivery.state === end) {
        return ok({ delivery, events: [] });
      }
      if (delivery.state !== 'acknowledged') {
        return refuse(
          'DELIVERY_NOT_ACKNOWLEDGED',
          `Delivery ${delivery.id} is ${delivery.state}, not acknowledged: report how its turn ended once the agent confirmed it`,
        );
      }
      if (end === 'notHandled' && delivery.handedOnceMoreAt === null) {
        return refuse(
          'DELIVERY_NOT_HANDED_ONCE_MORE',
          `Delivery ${delivery.id} was never handed once more: hand it once more after its turn died, and report it not handled only if that turn dies too`,
        );
      }
      return ok({
        delivery: { ...delivery, state: end },
        events: [
          {
            fleetId: delivery.fleetId,
            type: end === 'handled' ? 'DeliveryHandled' : 'DeliveryNotHandled',
            occurredAt: at,
            actor: shipActor(crew.shipId),
            shipId: crew.shipId,
            messageId: delivery.messageId,
            deliveryId: delivery.id,
            details: { leaseId: crew.leaseId, ...(reason === undefined ? {} : { reason }) },
          },
        ],
      });
    }
    case 'pending':
    case 'undeliverable':
    case 'dismissed':
    case 'abandoned':
      return refuse(
        'DELIVERY_NOT_IN_FLIGHT',
        `Delivery ${delivery.id} is ${delivery.state}, not in flight: report how its turn ended once the agent confirmed it`,
      );
  }
}

export type AcknowledgeRefusal = DomainError<'DELIVERY_NOT_IN_FLIGHT' | 'DELIVERY_HELD_BY_ANOTHER_SHIP'>;

/**
 * The ship takes responsibility for a delivery it received (ADR 0001): only a
 * delivery in flight with that ship, received or handed, moves to
 * acknowledged, keeping who it was handed to. A received one is taken too, so
 * a lost answer to handed never blocks the agent's confirmation. Acknowledging it again, also once handled or not handled, is harmless: OK, and nothing changes. A delivery
 * another ship holds or acknowledged, or one that is not in flight, is refused.
 */
export function acknowledgeDelivery(
  delivery: Delivery,
  ack: { crew: CrewOfShip; at: Date },
): Result<{ delivery: Delivery; events: NewEvent[] }, AcknowledgeRefusal> {
  const { crew, at } = ack;
  switch (delivery.state) {
    case 'received':
    case 'handed':
    case 'acknowledged':
    case 'handled':
    case 'notHandled':
      if (delivery.claimedByShipId !== crew.shipId) {
        return refuse(
          'DELIVERY_HELD_BY_ANOTHER_SHIP',
          `Delivery ${delivery.id} is held by another ship: only the ship that received it acknowledges it`,
        );
      }
      if (delivery.state !== 'received' && delivery.state !== 'handed') {
        return ok({ delivery, events: [] });
      }
      return ok({
        delivery: { ...delivery, state: 'acknowledged' },
        events: [
          {
            fleetId: delivery.fleetId,
            type: 'DeliveryAcknowledged',
            occurredAt: at,
            actor: shipActor(crew.shipId),
            shipId: crew.shipId,
            messageId: delivery.messageId,
            deliveryId: delivery.id,
            details: { leaseId: crew.leaseId },
          },
        ],
      });
    case 'pending':
    case 'undeliverable':
    case 'dismissed':
    case 'abandoned':
      return refuse(
        'DELIVERY_NOT_IN_FLIGHT',
        `Delivery ${delivery.id} is ${delivery.state}, not in flight: acknowledge a delivery once a receive hands it over`,
      );
  }
}

export type AnswerPingRefusal = DomainError<'DELIVERY_NOT_A_PING'> | AcknowledgeRefusal;

/**
 * The ship answers a ping with pong: the ping's delivery is acknowledged as
 * an ack would, and DeliveryAcknowledged says pong answered it. Pong answers
 * only a ping. Answering again, or after a plain ack, is harmless: OK, and
 * nothing changes, so the first answer stands.
 */
export function answerPing(
  delivery: Delivery,
  pong: { message: Message; crew: CrewOfShip; at: Date },
): Result<{ delivery: Delivery; events: NewEvent[] }, AnswerPingRefusal> {
  if (!isPingContentType(pong.message.contentType)) {
    return refuse('DELIVERY_NOT_A_PING', `Delivery ${delivery.id} is not a ping: pong answers only a ping, ack the others`);
  }
  const acknowledged = acknowledgeDelivery(delivery, pong);
  if (!acknowledged.isOk) {
    return acknowledged;
  }
  const events = acknowledged.value.events.map((event) => ({ ...event, details: { ...event.details, answer: 'pong' } }));
  return ok({ delivery: acknowledged.value.delivery, events });
}

export type DismissRefusal = DomainError<'DELIVERY_NOT_UNDELIVERABLE'>;

/**
 * The operator lets an undeliverable or not handled delivery go
 * (docs/blueprint.md, "DeliveryUndeliverable"): it becomes dismissed, kept in
 * history with its claims, and leaves Needs attention. The event names the
 * ship it was for; a delivery to a type names none. Dismissing it again is
 * harmless: OK, and nothing changes. Any other delivery is refused: only
 * those two wait for the operator.
 */
export function dismissDelivery(
  delivery: Delivery,
  dismiss: { by: ShipId; at: Date },
): Result<{ delivery: Delivery; events: NewEvent[] }, DismissRefusal> {
  switch (delivery.state) {
    case 'dismissed':
      return ok({ delivery, events: [] });
    case 'undeliverable':
    case 'notHandled':
      return ok({
        delivery: { ...delivery, state: 'dismissed' },
        events: [
          {
            fleetId: delivery.fleetId,
            type: 'DeliveryDismissed',
            occurredAt: dismiss.at,
            actor: shipActor(dismiss.by),
            shipId: delivery.recipient.kind === 'ship' ? delivery.recipient.shipId : undefined,
            messageId: delivery.messageId,
            deliveryId: delivery.id,
          },
        ],
      });
    case 'pending':
    case 'received':
    case 'handed':
    case 'acknowledged':
    case 'handled':
    case 'abandoned':
      return refuse(
        'DELIVERY_NOT_UNDELIVERABLE',
        `Delivery ${delivery.id} is ${delivery.state}: only an undeliverable or not handled delivery is dismissed`,
      );
  }
}

/**
 * A resend dismisses the delivery it resends, which must be undeliverable or
 * not handled: one already dismissed has nothing left to resend.
 */
export function dismissForResend(
  delivery: Delivery,
  dismiss: { by: ShipId; at: Date },
): Result<{ delivery: Delivery; events: NewEvent[] }, DismissRefusal> {
  return delivery.state === 'undeliverable' || delivery.state === 'notHandled'
    ? dismissDelivery(delivery, dismiss)
    : refuse(
        'DELIVERY_NOT_UNDELIVERABLE',
        `Delivery ${delivery.id} is ${delivery.state}: only an undeliverable or not handled delivery is resent`,
      );
}

export type MarkDoneRefusal = DomainError<'DELIVERY_NOT_FOUND' | 'DELIVERY_NOT_OPEN' | 'DELIVERY_HELD_BY_ANOTHER_SHIP'>;

/**
 * argo marks a message to it done (docs/blueprint.md, "Inbox"): the console
 * never receives, so an open delivery is handed and acknowledged at once
 * under the console session's lease, one attempt counted, and its two events
 * written as a receive and an ack would write them. One the session already
 * holds in flight is only acknowledged. The acknowledgement names the reply
 * that made it done, when a reply did. Marking it done again is harmless: OK,
 * and nothing changes. A delivery to another ship is not in argo's inbox; one
 * undeliverable, dismissed or abandoned is no longer open.
 */
export function markDone(
  delivery: Delivery,
  done: { crew: CrewOfShip; at: Date; reply?: MessageId },
): Result<{ delivery: Delivery; events: NewEvent[] }, MarkDoneRefusal> {
  const { crew, at, reply } = done;
  const { recipient } = delivery;
  if (recipient.kind !== 'ship' || recipient.shipId !== crew.shipId) {
    return refuse('DELIVERY_NOT_FOUND', `Delivery ${delivery.id} is not in your inbox`);
  }
  const concerns = {
    fleetId: delivery.fleetId,
    occurredAt: at,
    actor: shipActor(crew.shipId),
    shipId: crew.shipId,
    messageId: delivery.messageId,
    deliveryId: delivery.id,
  };
  const acknowledged: NewEvent = {
    ...concerns,
    type: 'DeliveryAcknowledged',
    details: { leaseId: crew.leaseId, ...(reply && { reply }) },
  };

  switch (delivery.state) {
    case 'acknowledged':
    case 'handled':
    case 'notHandled':
      return ok({ delivery, events: [] });
    case 'pending': {
      const attempts = delivery.attempts + 1;
      return ok({
        delivery: { ...delivery, state: 'acknowledged', claimedByShipId: crew.shipId, claimedByLeaseId: crew.leaseId, attempts },
        events: [{ ...concerns, type: 'DeliveryHanded', details: { leaseId: crew.leaseId, attempts } }, acknowledged],
      });
    }
    case 'received':
    case 'handed':
      return delivery.claimedByLeaseId === crew.leaseId
        ? ok({ delivery: { ...delivery, state: 'acknowledged' }, events: [acknowledged] })
        : refuse('DELIVERY_HELD_BY_ANOTHER_SHIP', `Delivery ${delivery.id} is held by another session`);
    case 'undeliverable':
    case 'dismissed':
    case 'abandoned':
      return refuse('DELIVERY_NOT_OPEN', `Delivery ${delivery.id} is ${delivery.state}: only an open message is marked done`);
  }
}

/** Whether the delivery is addressed to the ship itself: in its inbox, not its type's queue. */
export function isInInboxOf(delivery: Delivery | undefined, shipId: ShipId): delivery is Delivery {
  return delivery?.recipient.kind === 'ship' && delivery.recipient.shipId === shipId;
}
