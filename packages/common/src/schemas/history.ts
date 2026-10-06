import { z } from 'zod';

import { deliveryStateSchema, eventTypeSchema, locationKindSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';
import { listedShipSchema } from './fleet.js';
import { reportSchema } from './report.js';

/**
 * Inputs and outputs of the history procedures, for the ship page: one ship,
 * its timeline from the event log, its messages, and one message with the
 * history of its delivery. Every one reads with fleet:read.
 */

/** ISO 8601 in UTC. */
const isoTime = z.iso.datetime();

/** A ship as a party to an event or a message: its id (and so its suffix) and its name. */
export const partySchema = z.object({ id: idSchema('ship'), name: z.string() });

export type Party = z.infer<typeof partySchema>;

/** Who a message was addressed to: one ship, or any ship of a type. */
export const messageRecipientSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ship'), ship: partySchema }),
  z.object({ kind: z.literal('type'), type: z.string() }),
]);

export type MessageRecipient = z.infer<typeof messageRecipientSchema>;

/** Input of `fleet.ship`, `fleet.shipTimeline` and `fleet.shipMessages`. */
export const shipInputSchema = z.object({ shipId: idSchema('ship') });

/**
 * Output of `fleet.ship`: the ship as the overview lists it, with when it was
 * commissioned, since when its crew has held it (null while not crewed) and
 * when it retired.
 */
export const shipDetailOutputSchema = listedShipSchema.extend({
  /** The crew's last report as the fleet lists it, with its details. */
  report: reportSchema.nullable(),
  commissionedAt: isoTime,
  crewedSince: isoTime.nullable(),
  /** What its crew holds in flight now: what a release or a re-crew returns to pending. */
  inFlightDeliveries: z.int().min(0),
  /** Its direct deliveries pending or in flight: what a retire abandons. */
  openDeliveries: z.int().min(0),
});

export type ShipDetail = z.infer<typeof shipDetailOutputSchema>;

/** One event on a ship's timeline: its number, type and time, its parties and its small flat details. */
export const timelineEntrySchema = z.object({
  seq: z.number().int().positive(),
  id: idSchema('event'),
  type: eventTypeSchema,
  occurredAt: isoTime,
  /** The ship that caused it; null for the system. */
  actor: partySchema.nullable(),
  /** The ship it concerns, when it names one. */
  ship: partySchema.nullable(),
  /** The message it concerns, with its sender and recipient. */
  message: z
    .object({
      id: idSchema('message'),
      sender: partySchema,
      recipient: messageRecipientSchema,
      /** As the sender gave it; a ping has the reserved ping content type. */
      contentType: z.string(),
      /** The model the sender's session stated. */
      model: z.string().nullable(),
    })
    .nullable(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

/** Output of `fleet.shipTimeline`: the events that concern the ship, newest first. */
export const shipTimelineOutputSchema = z.array(timelineEntrySchema);

/** One message as the ship page lists it: parties, thread link, a preview of its payload and its delivery now. */
export const listedMessageSchema = z.object({
  id: idSchema('message'),
  sender: partySchema,
  recipient: messageRecipientSchema,
  inReplyTo: idSchema('message').nullable(),
  sentAt: isoTime,
  contentType: z.string(),
  /** The model the sender's session stated it runs; null from argo and on messages from before models were stated. */
  model: z.string().nullable(),
  /** The start of the payload, for the list; the whole payload comes with `fleet.message`. */
  preview: z.string(),
  delivery: z.object({
    id: idSchema('delivery'),
    state: deliveryStateSchema,
    /** The ship holding or having acknowledged it; null while pending. */
    claimedBy: partySchema.nullable(),
  }),
});

export type ListedMessage = z.infer<typeof listedMessageSchema>;

/** Output of `fleet.shipMessages`: the messages the ship sent, was sent or claimed, newest first. */
export const shipMessagesOutputSchema = z.array(listedMessageSchema);

/** Input of `fleet.message`. */
export const messageInputSchema = z.object({ messageId: idSchema('message') });

/** The event types that change a delivery: its history. */
export const DELIVERY_HISTORY_TYPES = [
  'MessageAccepted',
  'DeliveryClaimed',
  'DeliveryReturned',
  'DeliveryAcknowledged',
  'DeliveryUndeliverable',
  'DeliveryAbandoned',
  'DeliveryDismissed',
] as const;

/** One change to a delivery: when, which ship held it and where its session ran, and the claims counted by then. */
export const deliveryHistoryEntrySchema = z.object({
  seq: z.number().int().positive(),
  type: z.enum(DELIVERY_HISTORY_TYPES),
  occurredAt: isoTime,
  /** The ship that claimed, returned or acknowledged it; null when it was stored. */
  ship: partySchema.nullable(),
  /** Where the claiming session ran, for a claim. */
  location: z.object({ kind: locationKindSchema, description: z.string().nullable() }).nullable(),
  /** The harness the claiming session ran in, for a claim. */
  harness: z.string().nullable(),
  /** The claims counted so far, where the event records them. */
  attempts: z.number().int().nonnegative().nullable(),
});

export type DeliveryHistoryEntry = z.infer<typeof deliveryHistoryEntrySchema>;

/** Output of `fleet.message`: the envelope, the payload and the delivery with its history, newest first. */
export const messageOutputSchema = listedMessageSchema.omit({ preview: true, delivery: true }).extend({
  payload: z.string(),
  delivery: z.object({
    id: idSchema('delivery'),
    state: deliveryStateSchema,
    attempts: z.number().int().nonnegative(),
    claimedBy: partySchema.nullable(),
    history: z.array(deliveryHistoryEntrySchema),
  }),
});

export type MessageDetail = z.infer<typeof messageOutputSchema>;
