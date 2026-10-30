import {
  DELIVERY_HISTORY_TYPES,
  isPingContentType,
  type AccountId,
  type ComputerSide,
  type LeaseEndReason,
  type InboxFilter,
  type DeliveryId,
  type DeliveryState,
  type EventId,
  type EventType,
  type FleetId,
  type LabelValueId,
  type MeetingId,
  type MessageId,
  type ShipId,
} from '@aeolus-fleet/common';

import type { OverdueClock, StoredPayload } from '../messaging/public.js';
import type { ShipReport, Location, MessageParties } from '../registry/public.js';
import type { DeliveryStateStep, StandingOverdue, WayCrew, WayLease } from './delivery-way.js';
import type { EventDetails } from './events.js';
import type { Page, PageQuery } from './page.js';

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

/** A label value of a selection by its texts; both null once its label no longer has the value. */
export interface HistoryLabelValue {
  valueId: LabelValueId;
  key: string | null;
  value: string | null;
}

/** Who a message was addressed to: one ship, any ship of a type, a meeting, or a label selection by its texts (decision 0065). */
export type HistoryRecipient =
  | { kind: 'ship'; ship: HistoryParty }
  | { kind: 'type'; type: string }
  | { kind: 'meeting'; meetingId: MeetingId }
  | { kind: 'label'; values: readonly HistoryLabelValue[] };

/** One event on a ship's timeline, with its parties named. */
export interface TimelineEntry {
  seq: number;
  id: EventId;
  type: EventType;
  occurredAt: Date;
  /** The ship that caused it; null for the system. */
  actor: HistoryParty | null;
  /** The account signed in to the console as argo when argo caused it, by its id only (decision 0054). */
  signedInAccountId: AccountId | null;
  ship: HistoryParty | null;
  /** The message it concerns, with its parties and its content type, by which a ping is told. */
  message: { id: MessageId; sender: HistoryParty; recipient: HistoryRecipient; contentType: string; model: string | null } | null;
  details: EventDetails;
}

/**
 * A message's parties as read reach sees them; for a type, `claimedBy` is the
 * ship that claimed it, if one has. A contribution to a meeting is read
 * through its sender or the participant its delivery went to, `claimedBy`
 * here, else through its sender alone (decision 0061); so is a send to a
 * label, through the ship its delivery went to (decision 0065).
 */
export function partiesOf(message: { sender: HistoryParty; recipient: HistoryRecipient }, claimedBy: HistoryParty | null): MessageParties {
  const { sender, recipient } = message;
  return {
    senderId: sender.id,
    recipient: recipientParty(recipient, claimedBy ?? sender),
    claimedBy: claimedBy?.id ?? null,
  };
}

function recipientParty(recipient: HistoryRecipient, participant: HistoryParty): MessageParties['recipient'] {
  switch (recipient.kind) {
    case 'ship':
      return { kind: 'ship', shipId: recipient.ship.id };
    case 'type':
      return recipient;
    case 'meeting':
    case 'label':
      return { kind: 'ship', shipId: participant.id };
  }
}

/** A message as a read shows it: whether it is a ping, told by its content type, so no reader repeats that rule. */
export type WithPing<T extends { contentType: string }> = T & { isPing: boolean };

export function withPing<T extends { contentType: string }>(message: T): WithPing<T> {
  return { ...message, isPing: isPingContentType(message.contentType) };
}

/** A timeline entry as the read answers it, its message telling whether it is a ping. */
export type ShownTimelineEntry = Omit<TimelineEntry, 'message'> & { message: WithPing<NonNullable<TimelineEntry['message']>> | null };

/** A delivery in Needs attention as it is answered, its message telling whether it is a ping. */
export type ShownNeedsAttentionEntry<Payload = string> = Omit<NeedsAttentionEntry<Payload>, 'message'> & { message: WithPing<NeedsAttentionEntry<Payload>['message']> };

/** One message with its delivery as it stands; its payload plain, or as stored when the port reads it (decision 0068). */
export interface HistoryMessage<Payload = string> {
  id: MessageId;
  sender: HistoryParty;
  recipient: HistoryRecipient;
  inReplyTo: MessageId | null;
  sentAt: Date;
  contentType: string;
  /** The model the sender's session stated; none from argo and on messages from before models were stated. */
  model: string | null;
  payload: Payload;
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
  /** The channel a pushed hand-over went through, as its computer side named it (interop 5.1). */
  channel: string | null;
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
 * One delivery of a message: the ship it went to, or the ship of the type
 * that claimed it (null while none has), its state, and the steps that tell
 * when it entered it, newest first.
 */
export interface MessageDelivery {
  id: DeliveryId;
  ship: HistoryParty | null;
  state: DeliveryState;
  steps: DeliveryStateStep[];
  report: ShipReport | null;
}

/**
 * One message as the history reads it: its delivery's steps newest first,
 * its replies oldest first, and what its way is read from: the lease that
 * holds it or that a pending delivery to one ship waits for, the overdue
 * clock that stands, and the crew request of that lease's ship. How many
 * deliveries it has comes too: one per ship of a send to a label (decision
 * 0065), whose first by id is the delivery above.
 */
export type MessageRead<Payload = string> = HistoryMessage<Payload> & {
  history: DeliveryChange[];
  deliveryCount: number;
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
export interface NeedsAttentionEntry<Payload = string> {
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
  message: Omit<HistoryMessage<Payload>, 'delivery'>;
}

/** The delivery states Needs attention lists, each waiting for the operator to resend or dismiss it. */
export type NeedsAttentionState = Extract<DeliveryState, 'undeliverable' | 'notHandled'>;

/** A reply the inbox's ship sent to a message in its inbox. */
export interface InboxReply<Payload = string> {
  id: MessageId;
  contentType: string;
  payload: Payload;
  sentAt: Date;
}

/**
 * A message to a ship, as its inbox lists it: its delivery's state, when it
 * was read and done, the reply that made it done, and every reply the ship
 * sent to it, oldest first.
 */
export interface InboxEntry<Payload = string> {
  deliveryId: DeliveryId;
  state: DeliveryState;
  readAt: Date | null;
  doneAt: Date | null;
  repliedWith: MessageId | null;
  replies: InboxReply<Payload>[];
  message: Omit<HistoryMessage<Payload>, 'delivery' | 'recipient'>;
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
 * such ship or message. Payloads come as stored, sealed in a sealed fleet:
 * the reads unseal them (decision 0068, B9).
 */
export interface ShipHistory {
  /** A page newest first, by the stream's order, after the event the cursor names. */
  timeline(fleetId: FleetId, query: { shipId: ShipId } & PageQuery<EventId>): Promise<Page<TimelineEntry, EventId> | undefined>;
  /** A page newest first, by id, after the message the cursor names. */
  messages(fleetId: FleetId, query: { shipId: ShipId } & PageQuery<MessageId>): Promise<Page<HistoryMessage<StoredPayload>, MessageId> | undefined>;
  /** The message, with its delivery's steps newest first and what its way is read from. */
  message(fleetId: FleetId, messageId: MessageId): Promise<MessageRead<StoredPayload> | undefined>;
  /** A page of the message's deliveries by id, after the delivery the cursor names; empty when the fleet has no such message. */
  messageDeliveries(fleetId: FleetId, query: { messageId: MessageId } & PageQuery<DeliveryId>): Promise<Page<MessageDelivery, DeliveryId>>;
  /**
   * A page of the undeliverable or not handled deliveries, or those in one
   * of the two states, the fleet's or those naming one ship, oldest first by since when, after the delivery the
   * cursor names: by its since, so a cursor dismissed meanwhile still holds.
   */
  needsAttention(fleetId: FleetId, query: { shipId?: ShipId; state?: NeedsAttentionState } & PageQuery<DeliveryId>): Promise<Page<NeedsAttentionEntry<StoredPayload>, DeliveryId>>;
  /** What the ship's side of the way is read from: the open lease of the session crewing it and what waits for it. */
  shipWay(fleetId: FleetId, shipId: ShipId): Promise<ShipWayRead | undefined>;
  /** A page of the messages addressed to the ship itself that the filter keeps, newest first by delivery, after the delivery the cursor names. */
  inbox(fleetId: FleetId, query: { shipId: ShipId; filter: InboxFilter } & PageQuery<DeliveryId>): Promise<Page<InboxEntry<StoredPayload>, DeliveryId>>;
  /** The message to the ship itself with this delivery, as its inbox lists it; undefined when its inbox has none. */
  inboxMessage(fleetId: FleetId, query: { shipId: ShipId; deliveryId: DeliveryId }): Promise<InboxEntry<StoredPayload> | undefined>;
  /**
   * A page of the messages to the ship itself that withdraw or replace the
   * question with this uuid (decision 0038), oldest first by delivery, after
   * the delivery the cursor names, found by the question's uuid alone.
   */
  inboxWithdrawals(fleetId: FleetId, query: { shipId: ShipId; questionId: string } & PageQuery<DeliveryId>): Promise<Page<InboxEntry<StoredPayload>, DeliveryId>>;
  /** How many messages to the ship itself are open; with senders, only those they sent. */
  openInboxCount(fleetId: FleetId, query: { shipId: ShipId; senderIds?: ReadonlySet<ShipId> }): Promise<number>;
  /** Each message's parties as read reach sees them, by id; a message the fleet does not have is left out. */
  messageParties(fleetId: FleetId, messageIds: readonly MessageId[]): Promise<ReadonlyMap<MessageId, MessageParties>>;
}
