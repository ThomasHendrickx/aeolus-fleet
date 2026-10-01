import {
  DELIVERY_HISTORY_TYPES,
  type InboxFilter,
  type DeliveryId,
  type DeliveryState,
  type EventId,
  type EventType,
  type FleetId,
  type MessageId,
  type ShipId,
} from '@aeolus-fleet/common';

import type { Location } from '../registry/public.js';
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
  message: { id: MessageId; sender: HistoryParty; recipient: HistoryRecipient } | null;
  details: EventDetails;
}

/** One message with its delivery as it stands. */
export interface HistoryMessage {
  id: MessageId;
  sender: HistoryParty;
  recipient: HistoryRecipient;
  inReplyTo: MessageId | null;
  sentAt: Date;
  contentType: string;
  payload: string;
  delivery: { id: DeliveryId; state: DeliveryState; attempts: number; claimedBy: HistoryParty | null };
}

/** The events that change a delivery: stored, claimed, returned, acknowledged or undeliverable. */
export type DeliveryChangeType = (typeof DELIVERY_HISTORY_TYPES)[number];

export function isDeliveryChangeType(type: EventType): type is DeliveryChangeType {
  return DELIVERY_HISTORY_TYPES.some((change) => change === type);
}

/** One change to a delivery. */
export interface DeliveryChange {
  seq: number;
  type: DeliveryChangeType;
  occurredAt: Date;
  /** The ship that claimed, returned or acknowledged it; null when it was stored. */
  ship: HistoryParty | null;
  /** Where the claiming session ran, for a claim. */
  location: Location | null;
  /** The claims counted by then, where the event records them. */
  attempts: number | null;
}

/** An undeliverable delivery, for Needs attention: its claims, since when, and its whole message. */
export interface UndeliverableEntry {
  deliveryId: DeliveryId;
  attempts: number;
  /** When it became undeliverable. */
  since: Date;
  message: Omit<HistoryMessage, 'delivery'>;
}

/** A message to a ship, as its inbox lists it: its delivery's state, when it was read and done, and the reply that made it done. */
export interface InboxEntry {
  deliveryId: DeliveryId;
  state: DeliveryState;
  readAt: Date | null;
  doneAt: Date | null;
  repliedWith: MessageId | null;
  message: Omit<HistoryMessage, 'delivery' | 'recipient'>;
}

/** The delivery states each inbox filter keeps: open is not done yet, done is acknowledged. */
export function isKeptBy(filter: InboxFilter, state: DeliveryState): boolean {
  switch (filter) {
    case 'open':
      return state === 'pending' || state === 'delivered';
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
  /** The message, with its delivery's changes newest first. */
  message(
    fleetId: FleetId,
    messageId: MessageId,
  ): Promise<(HistoryMessage & { history: DeliveryChange[] }) | undefined>;
  /** Every undeliverable delivery, oldest first by when it became undeliverable. */
  undeliverable(fleetId: FleetId): Promise<UndeliverableEntry[]>;
  /** The messages addressed to the ship itself that the filter keeps, newest first. */
  inbox(fleetId: FleetId, query: { shipId: ShipId; filter: InboxFilter }): Promise<InboxEntry[]>;
}
