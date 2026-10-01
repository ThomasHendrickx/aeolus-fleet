import {
  DELIVERY_HISTORY_TYPES,
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
 * What the ship page reads: a ship's timeline from the event log, its
 * messages, and one message with the history of its delivery. Read models
 * only: they change nothing, so they need no unit of work.
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
}
