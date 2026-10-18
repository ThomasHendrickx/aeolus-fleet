import {
  DELIVERY_HISTORY_TYPES,
  isPingContentType,
  type ComputerSide,
  type LeaseEndReason,
  type InboxFilter,
  type DeliveryId,
  type DeliveryState,
  type EventId,
  type EventType,
  type FleetId,
  type MessageId,
  type ShipId,
} from '@aeolus-fleet/common';

import type { OverdueClock, WaitingState } from '../messaging/public.js';
import type { Location, MessageParties } from '../registry/public.js';
import type { StandingOverdue, WayCrew, WayLease } from './delivery-way.js';
import type { EventDetails } from './events.js';

/**
 * What the console reads: a ship's timeline from the event log, its
 * messages, one message with the history of its delivery, and the
 * undeliverable deliveries of Needs attention. Read models only: they change
 * nothing, so they need no unit of work.
 */

/** A ship as a party to an event or a message. */
export interface HistoryParty {
  id: ShipId;
  name: string;
}

/** Who a message was addressed to: one ship, or any ship of a type. */
export type HistoryRecipient = { kind: 'ship'; ship: HistoryParty } | { kind: 'type'; type: string };

/** One event on a ship's timeline, with its parties named. */
export interface TimelineEntry {
  seq: number;
  id: EventId;
  type: EventType;
  occurredAt: Date;
  /** The ship that caused it; null for the system. */
  actor: HistoryParty | null;
  ship: HistoryParty | null;
  /** The message it concerns, with its parties and its content type, by which a ping is told. */
  message: { id: MessageId; sender: HistoryParty; recipient: HistoryRecipient; contentType: string; model: string | null } | null;
  details: EventDetails;
}

/** A message's parties as read reach sees them; for a type, `claimedBy` is the ship that claimed it, if one has. */
export function partiesOf(message: { sender: HistoryParty; recipient: HistoryRecipient }, claimedBy: HistoryParty | null): MessageParties {
  const { sender, recipient } = message;
  return {
    senderId: sender.id,
    recipient: recipient.kind === 'ship' ? { kind: 'ship', shipId: recipient.ship.id } : recipient,
    claimedBy: claimedBy?.id ?? null,
  };
}

/** A message as a read shows it: whether it is a ping, told by its content type, so no reader repeats that rule. */
export type WithPing<T extends { contentType: string }> = T & { isPing: boolean };

export function withPing<T extends { contentType: string }>(message: T): WithPing<T> {
  return { ...message, isPing: isPingContentType(message.contentType) };
}

/** A timeline entry as the read answers it, its message telling whether it is a ping. */
export type ShownTimelineEntry = Omit<TimelineEntry, 'message'> & { message: WithPing<NonNullable<TimelineEntry['message']>> | null };

/** A delivery no ship can take as it is answered, its message telling whether it is a ping. */
export type ShownNoShipCanTakeEntry = Omit<NoShipCanTakeEntry, 'message'> & { message: WithPing<NoShipCanTakeEntry['message']> };

/** An overdue delivery as it is answered, its message telling whether it is a ping. */
export type ShownOverdueEntry = Omit<OverdueEntry, 'message'> & { message: WithPing<OverdueEntry['message']> };

/** A delivery in Needs attention as it is answered, its message telling whether it is a ping. */
export type ShownNeedsAttentionEntry = Omit<NeedsAttentionEntry, 'message'> & { message: WithPing<NeedsAttentionEntry['message']> };

/** One message with its delivery as it stands. */
export interface HistoryMessage {
  id: MessageId;
  sender: HistoryParty;
  recipient: HistoryRecipient;
  inReplyTo: MessageId | null;
  sentAt: Date;
  contentType: string;
  /** The model the sender's session stated; none from argo and on messages from before models were stated. */
  model: string | null;
  payload: string;
  delivery: {
    id: DeliveryId;
    state: DeliveryState;
    attempts: number;
    claimedBy: HistoryParty | null;
    /** The number of its last hand-over by a pushed crew's computer side; null when a plain receive or a push receive took it last, or before any. */
    handOverNumber: number | null;
  };
}

/** The events of a delivery's way: stored, received, handed, returned, acknowledged, handled or not, overdue, and its dead ends. */
export type DeliveryChangeType = (typeof DELIVERY_HISTORY_TYPES)[number];

export function isDeliveryChangeType(type: EventType): type is DeliveryChangeType {
  return DELIVERY_HISTORY_TYPES.some((change) => change === type);
}

/** One step of a delivery's way. */
export interface DeliveryChange {
  seq: number;
  type: DeliveryChangeType;
  occurredAt: Date;
  /** The ship that received, was handed, returned or acknowledged it; null when it was stored. */
  ship: HistoryParty | null;
  /** Where the claiming session ran, for a hand-over. */
  location: Location | null;
  /** The harness the claiming session ran in, for a hand-over. */
  harness: string | null;
  /** The attempts counted by then, where the event records them. */
  attempts: number | null;
  /** The computer side that received it or handed it over, on a pushed lease. */
  by: ComputerSide | null;
  /** The number of a pushed hand-over; none for a plain receive's. */
  handOverNumber: number | null;
  /** A push receive of a delivery its crew already held. */
  isAgain: boolean;
  /** A confirmed message handed once more after its turn died. */
  isOnceMore: boolean;
  /** Which clock ran out and after how long, for DeliveryOverdue. */
  overdue: { clock: OverdueClock; minutes: number } | null;
  /** Why its lease ended, for DeliveryReturned. */
  leaseEnd: LeaseEndReason | null;
}

/** A reply to a message. */
export interface HistoryReply {
  id: MessageId;
  sender: HistoryParty;
  sentAt: Date;
}

/**
 * One message as the history reads it: its delivery's steps newest first,
 * its replies oldest first, and what its way is read from: the lease that
 * holds it or that a pending delivery to one ship waits for, the overdue
 * clock that stands, and the crew request of that lease's ship.
 */
export type MessageRead = HistoryMessage & {
  history: DeliveryChange[];
  replies: HistoryReply[];
  lease: WayLease | null;
  overdue: StandingOverdue | null;
  crew: WayCrew | null;
};

/**
 * What a ship's side of the way is read from (#756): the open lease of the
 * session crewing it, and the messages whose deliveries wait for it, oldest
 * sent first. A delivery waits for it as the clocks count it: pending for the
 * ship or for a type it may take, or received or handed with its open lease.
 * Nothing waits while no session crews it.
 */
export interface ShipWayRead {
  lease: WayLease | null;
  waiting: MessageId[];
}

/**
 * A delivery in Needs attention: undeliverable, or not handled after its turn
 * died twice (decision 0040). Its claims, since when, and its whole message.
 */
export interface NeedsAttentionEntry {
  deliveryId: DeliveryId;
  state: NeedsAttentionState;
  attempts: number;
  /** A pushed crew's computer side handed it over, with numbers; false when plain receives handed it. */
  isPushed: boolean;
  /** When it became undeliverable, or was reported not handled. */
  since: Date;
  /** Why its crew reported it not handled, kept with DeliveryNotHandled (#847); null when undeliverable, or when the crew gave none. */
  reason: string | null;
  /** The ship whose attempt made it undeliverable, or whose turn did not handle it. */
  ship: HistoryParty;
  message: Omit<HistoryMessage, 'delivery'>;
}

/** The delivery states Needs attention lists, each waiting for the operator to resend or dismiss it. */
export type NeedsAttentionState = Extract<DeliveryState, 'undeliverable' | 'notHandled'>;

/**
 * A delivery argo was told is overdue (decision 0040): the ship whose clock
 * ran out, the state it waits in, which clock, when argo was told, and its
 * whole message. Listed until it clears by itself.
 */
export interface OverdueEntry {
  deliveryId: DeliveryId;
  ship: HistoryParty;
  state: WaitingState;
  clock: OverdueClock;
  minutes: number;
  toldAt: Date;
  message: Omit<HistoryMessage, 'delivery'>;
}

/**
 * A pending delivery to a type no active ship can take (decision 0041): none
 * of the type is left, or none of the ships its sender may reach (decision
 * 0034). Its type and its whole message; listed until a ship can take it.
 */
export interface NoShipCanTakeEntry {
  deliveryId: DeliveryId;
  type: string;
  message: Omit<HistoryMessage, 'delivery'>;
}

/** A reply the inbox's ship sent to a message in its inbox. */
export interface InboxReply {
  id: MessageId;
  contentType: string;
  payload: string;
  sentAt: Date;
}

/**
 * A message to a ship, as its inbox lists it: its delivery's state, when it
 * was read and done, the reply that made it done, and every reply the ship
 * sent to it, oldest first.
 */
export interface InboxEntry {
  deliveryId: DeliveryId;
  state: DeliveryState;
  readAt: Date | null;
  doneAt: Date | null;
  repliedWith: MessageId | null;
  replies: InboxReply[];
  message: Omit<HistoryMessage, 'delivery' | 'recipient'>;
}

/** The delivery states each inbox filter keeps: open is not done yet, done is acknowledged. */
export function isKeptBy(filter: InboxFilter, state: DeliveryState): boolean {
  switch (filter) {
    case 'open':
      return state === 'pending' || state === 'received' || state === 'handed';
    case 'done':
      return state === 'acknowledged';
    case 'all':
      return true;
  }
}

/**
 * Outbound port: the history reads, scoped to one fleet. A ship's timeline is
 * the events naming it or caused by it; its messages are those it sent, was
 * sent, or claimed as a ship of their type. Undefined when the fleet has no
 * such ship or message.
 */
export interface ShipHistory {
  /** Newest first, at most `limit`. */
  timeline(fleetId: FleetId, query: { shipId: ShipId; limit: number }): Promise<TimelineEntry[] | undefined>;
  /** Newest first, at most `limit`. */
  messages(fleetId: FleetId, query: { shipId: ShipId; limit: number }): Promise<HistoryMessage[] | undefined>;
  /** The message, with its delivery's steps newest first and what its way is read from. */
  message(fleetId: FleetId, messageId: MessageId): Promise<MessageRead | undefined>;
  /** Every undeliverable or not handled delivery, oldest first by since when. */
  needsAttention(fleetId: FleetId): Promise<NeedsAttentionEntry[]>;
  /**
   * Every delivery argo was told is overdue that still stands, oldest told
   * first: still in the state it was told in, on the lease it was told on,
   * which has not ended.
   */
  overdue(fleetId: FleetId): Promise<OverdueEntry[]>;
  /** Every pending delivery to a type no active ship can take, oldest sent first. */
  noShipCanTake(fleetId: FleetId): Promise<NoShipCanTakeEntry[]>;
  /** What the ship's side of the way is read from: the open lease of the session crewing it and what waits for it. */
  shipWay(fleetId: FleetId, shipId: ShipId): Promise<ShipWayRead | undefined>;
  /** The messages addressed to the ship itself that the filter keeps, newest first. */
  inbox(fleetId: FleetId, query: { shipId: ShipId; filter: InboxFilter }): Promise<InboxEntry[]>;
}
