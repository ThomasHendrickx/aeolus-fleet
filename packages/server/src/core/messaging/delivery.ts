import type { LeaseId, MessageId, ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor, type NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { Delivery } from './message.js';

/**
 * The Delivery's rules once it is stored (docs/blueprint.md, "Key flows"): a
 * receive claims it, the claiming ship acknowledges it, and a delivery that
 * keeps being claimed without an acknowledgement stops, undeliverable, where
 * the operator sees it.
 */

/**
 * The claim at which a delivery never acknowledged becomes undeliverable
 * instead of being handed out again: the fifth. A poison message stops there
 * rather than looping forever.
 */
export const UNDELIVERABLE_AT_CLAIM = 5;

/** The crew a receive or an ack comes from: its ship and the lease it crews it under. */
export interface CrewOfShip {
  shipId: ShipId;
  leaseId: LeaseId;
}

export interface DeliveryClaim {
  /** Claimed: handed to the crew. Undeliverable: this was the fifth claim, so it is not handed out. */
  outcome: 'claimed' | 'undeliverable';
  delivery: Delivery;
  events: NewEvent[];
}

/**
 * A crew claims a delivery it may take: one pending for its ship or its type,
 * or one of its own in flight, returned again after a lost reply. Every claim
 * counts. The claim that reaches the fifth makes the delivery undeliverable
 * and hands it to no one; before that, the delivery is in flight with the
 * crew's ship and lease. Either change is caused by the receiving ship.
 */
export function claimDelivery(delivery: Delivery, claim: { crew: CrewOfShip; at: Date }): DeliveryClaim {
  const { crew, at } = claim;
  const attempts = delivery.attempts + 1;
  const concerns = {
    fleetId: delivery.fleetId,
    occurredAt: at,
    actor: shipActor(crew.shipId),
    shipId: crew.shipId,
    messageId: delivery.messageId,
    deliveryId: delivery.id,
    details: { leaseId: crew.leaseId, attempts },
  };

  if (attempts >= UNDELIVERABLE_AT_CLAIM) {
    return {
      outcome: 'undeliverable',
      delivery: { ...delivery, state: 'undeliverable', claimedByShipId: null, claimedByLeaseId: null, attempts },
      events: [{ ...concerns, type: 'DeliveryUndeliverable' }],
    };
  }
  return {
    outcome: 'claimed',
    delivery: { ...delivery, state: 'delivered', claimedByShipId: crew.shipId, claimedByLeaseId: crew.leaseId, attempts },
    events: [{ ...concerns, type: 'DeliveryClaimed' }],
  };
}

export type AcknowledgeRefusal = DomainError<'DELIVERY_NOT_IN_FLIGHT' | 'DELIVERY_HELD_BY_ANOTHER_SHIP'>;

/**
 * The ship takes responsibility for a delivery it received (ADR 0001): only a
 * delivery in flight with that ship moves to acknowledged, keeping who claimed
 * it. Acknowledging it again is harmless: OK, and nothing changes. A delivery
 * another ship holds or acknowledged, or one that is not in flight, is refused.
 */
export function acknowledgeDelivery(
  delivery: Delivery,
  ack: { crew: CrewOfShip; at: Date },
): Result<{ delivery: Delivery; events: NewEvent[] }, AcknowledgeRefusal> {
  const { crew, at } = ack;
  switch (delivery.state) {
    case 'delivered':
    case 'acknowledged':
      if (delivery.claimedByShipId !== crew.shipId) {
        return refuse(
          'DELIVERY_HELD_BY_ANOTHER_SHIP',
          `Delivery ${delivery.id} is held by another ship: only the ship that received it acknowledges it`,
        );
      }
      if (delivery.state === 'acknowledged') {
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

export type DismissRefusal = DomainError<'DELIVERY_NOT_UNDELIVERABLE'>;

/**
 * The operator lets an undeliverable delivery go (docs/blueprint.md,
 * "DeliveryUndeliverable"): it becomes dismissed, kept in history with its
 * claims, and leaves Needs attention. The event names the ship it was for; a
 * delivery to a type names none. Dismissing it again is harmless: OK, and
 * nothing changes. Any other delivery is refused: only an undeliverable one
 * waits for the operator.
 */
export function dismissDelivery(
  delivery: Delivery,
  dismiss: { by: ShipId; at: Date },
): Result<{ delivery: Delivery; events: NewEvent[] }, DismissRefusal> {
  switch (delivery.state) {
    case 'dismissed':
      return ok({ delivery, events: [] });
    case 'undeliverable':
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
    case 'delivered':
    case 'acknowledged':
    case 'abandoned':
      return refuse(
        'DELIVERY_NOT_UNDELIVERABLE',
        `Delivery ${delivery.id} is ${delivery.state}, not undeliverable: only an undeliverable delivery is dismissed`,
      );
  }
}

/**
 * A resend dismisses the delivery it resends, which must be undeliverable:
 * one already dismissed has nothing left to resend.
 */
export function dismissForResend(
  delivery: Delivery,
  dismiss: { by: ShipId; at: Date },
): Result<{ delivery: Delivery; events: NewEvent[] }, DismissRefusal> {
  return delivery.state === 'undeliverable'
    ? dismissDelivery(delivery, dismiss)
    : refuse(
        'DELIVERY_NOT_UNDELIVERABLE',
        `Delivery ${delivery.id} is ${delivery.state}, not undeliverable: only an undeliverable delivery is resent`,
      );
}

export type MarkDoneRefusal = DomainError<'DELIVERY_NOT_FOUND' | 'DELIVERY_NOT_OPEN' | 'DELIVERY_HELD_BY_ANOTHER_SHIP'>;

/**
 * argo marks a message to it done (docs/blueprint.md, "Inbox"): the console
 * never receives, so an open delivery is claimed and acknowledged at once
 * under the console session's lease, one claim counted, and its two events
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
      return ok({ delivery, events: [] });
    case 'pending': {
      const attempts = delivery.attempts + 1;
      return ok({
        delivery: { ...delivery, state: 'acknowledged', claimedByShipId: crew.shipId, claimedByLeaseId: crew.leaseId, attempts },
        events: [{ ...concerns, type: 'DeliveryClaimed', details: { leaseId: crew.leaseId, attempts } }, acknowledged],
      });
    }
    case 'delivered':
      return delivery.claimedByLeaseId === crew.leaseId
        ? ok({ delivery: { ...delivery, state: 'acknowledged' }, events: [acknowledged] })
        : refuse('DELIVERY_HELD_BY_ANOTHER_SHIP', `Delivery ${delivery.id} is held by another session`);
    case 'undeliverable':
    case 'dismissed':
    case 'abandoned':
      return refuse('DELIVERY_NOT_OPEN', `Delivery ${delivery.id} is ${delivery.state}: only an open message is marked done`);
  }
}
