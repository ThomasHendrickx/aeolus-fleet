import { z } from 'zod';

import { deliveryStateSchema, eventTypeSchema, locationKindSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';
import { accountIdSchema } from './account-token.js';
import { listedShipSchema, shipOutsideReadReachSchema } from './fleet.js';
import { crewRequestSchema, crewStatusSchema } from './crew-request.js';
import { reportSchema } from './report.js';
import { discoveredStatementSchema } from './statement.js';
import { turnStateSchema } from './turn.js';

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
  /** The crew's last report as the fleet lists it, with its details and their size in bytes (null without details), counted as their limit counts them. */
  report: reportSchema.extend({ detailsBytes: z.int().min(0).nullable() }).nullable(),
  /** The ship's crew request, settings included. */
  crewRequest: crewRequestSchema.nullable(),
  commissionedAt: isoTime,
  crewedSince: isoTime.nullable(),
  /** What its crew holds in flight now: what a release or a re-crew returns to pending. */
  inFlightDeliveries: z.int().min(0),
  /** Its direct deliveries pending or in flight: what a retire abandons. */
  openDeliveries: z.int().min(0),
  /** Its owner by id and name; null for argo and the viewer (decision 0045). */
  owner: partySchema.nullable(),
  /** What it is and offers, as discovery shows it: its crew's statement, else its commission note, else none (decision 0047). */
  statement: discoveredStatementSchema,
});

export type ShipDetail = z.infer<typeof shipDetailOutputSchema>;

/** Output of `fleet.ship`: the ship whole, or outside the caller's read reach its name, type and status only (decision 0034). */
export const shipOutputSchema = z.union([shipDetailOutputSchema, shipOutsideReadReachSchema]);

/** One event on a ship's timeline: its number, type and time, its parties and its small flat details. */
export const timelineEntrySchema = z.object({
  seq: z.number().int().positive(),
  id: idSchema('event'),
  type: eventTypeSchema,
  occurredAt: isoTime,
  /** The ship that caused it; null for the system. */
  actor: partySchema.nullable(),
  /** The account signed in to the console as argo when argo caused it, by its id only; null otherwise (decision 0054). */
  signedInAccountId: accountIdSchema.nullable(),
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
      /** Whether it is a ping, told by its content type. */
      isPing: z.boolean(),
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
    /** Handed by a plain receive, with no hand-over number: it reads handed (pulled). False in every other state. */
    isPulled: z.boolean(),
  }),
});

export type ListedMessage = z.infer<typeof listedMessageSchema>;

/** Output of `fleet.shipMessages`: the messages the ship sent, was sent or claimed, newest first. */
export const shipMessagesOutputSchema = z.array(listedMessageSchema);

/** Input of `fleet.message`. */
export const messageInputSchema = z.object({ messageId: idSchema('message') });

/** The event types of a delivery's way through: its history. */
export const DELIVERY_HISTORY_TYPES = [
  'MessageAccepted',
  'DeliveryReceived',
  'DeliveryHanded',
  'DeliveryReturned',
  'DeliveryAcknowledged',
  'DeliveryHandled',
  'DeliveryNotHandled',
  'DeliveryOverdue',
  'DeliveryUndeliverable',
  'DeliveryAbandoned',
  'DeliveryDismissed',
] as const;

/** The 10 and 60 minute clocks (decision 0040): handed and not confirmed, or waiting while the session is idle or busy. */
export const OVERDUE_CLOCKS = ['notConfirmed', 'idle', 'busy'] as const;
export const overdueClockSchema = z.enum(OVERDUE_CLOCKS);
export type OverdueClock = z.infer<typeof overdueClockSchema>;

/** Why a lease ended, as its LeaseRevoked says. */
export const LEASE_END_REASONS = ['released', 'retired', 'deregistered', 'takenOver', 'signedOut', 'passwordReset', 'accountCutOff'] as const;
export const leaseEndReasonSchema = z.enum(LEASE_END_REASONS);
export type LeaseEndReason = z.infer<typeof leaseEndReasonSchema>;

/**
 * What wakes a pushed ship, as its first push receive states it (decision
 * 0040, interop 5.1): the trierarch, the plugin watcher, a person's app, the
 * gateway, or an app's own adapter.
 */
export const LEASE_WAKERS = ['trierarch', 'pluginWatcher', 'personApp', 'gateway', 'adapter'] as const;

export const leaseWakerSchema = z.enum(LEASE_WAKERS);

export type LeaseWaker = z.infer<typeof leaseWakerSchema>;

/**
 * The computer side of a pushed lease, which receives and hands over for its
 * session (decision 0040): the trierarch that crewed it, named by its ship,
 * which is named for its computer, the plugin watcher of a session crewed
 * by hand, or what the lease stated wakes it: a person's app, the gateway or
 * an app's adapter.
 */
export const computerSideSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('trierarch'), trierarch: partySchema }),
  z.object({ kind: z.literal('pluginWatcher') }),
  z.object({ kind: z.literal('personApp') }),
  z.object({ kind: z.literal('gateway') }),
  z.object({ kind: z.literal('adapter') }),
]);

export type ComputerSide = z.infer<typeof computerSideSchema>;

/** Who holds a delivery now: the fleet, a computer side, or the agent. */
export const deliveryHolderSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fleet') }),
  ...computerSideSchema.options,
  z.object({ kind: z.literal('agent') }),
]);

export type DeliveryHolder = z.infer<typeof deliveryHolderSchema>;

/** One step of a delivery's way: when, which ship held it and where its session ran, and what the step says of itself. */
export const deliveryHistoryEntrySchema = z.object({
  seq: z.number().int().positive(),
  type: z.enum(DELIVERY_HISTORY_TYPES),
  occurredAt: isoTime,
  /** The ship that received, was handed, returned or acknowledged it; null when it was stored. */
  ship: partySchema.nullable(),
  /** Where the claiming session ran, for a hand-over. */
  location: z.object({ kind: locationKindSchema, description: z.string().nullable() }).nullable(),
  /** The harness the claiming session ran in, for a hand-over. */
  harness: z.string().nullable(),
  /** The attempts counted so far, where the event records them. */
  attempts: z.number().int().nonnegative().nullable(),
  /** The computer side that received it or handed it over, on a pushed lease; null otherwise. */
  by: computerSideSchema.nullable(),
  /** The number of a pushed hand-over; null for a plain receive's (pulled). */
  handOverNumber: z.int().min(1).nullable(),
  /** The channel a pushed hand-over went through, as its computer side named it (interop 5.1); null when it named none. */
  channel: z.string().nullable(),
  /** A push receive of a delivery its crew already held: nothing changed. */
  isAgain: z.boolean(),
  /** A confirmed message handed once more after its turn died. */
  isOnceMore: z.boolean(),
  /** Which clock ran out and after how long, for DeliveryOverdue. */
  overdue: z.object({ clock: overdueClockSchema, minutes: z.int().min(1) }).nullable(),
  /** Why the lease ended, for DeliveryReturned. */
  leaseEnd: leaseEndReasonSchema.nullable(),
});

export type DeliveryHistoryEntry = z.infer<typeof deliveryHistoryEntrySchema>;

/**
 * Where a delivery stands on its way: who holds it, since when its state
 * holds, whether a plain receive handed it (pulled), the overdue clock argo
 * was told of that still stands, the lease that holds it or waits for it with
 * its computer side and its turn, and the crew its trierarch runs.
 */
export const deliveryWaySchema = z.object({
  holder: deliveryHolderSchema.nullable(),
  since: isoTime,
  isPulled: z.boolean(),
  overdue: z.object({ clock: overdueClockSchema, minutes: z.int().min(1), toldAt: isoTime }).nullable(),
  lease: z
    .object({
      /** Null on a pull lease. */
      by: computerSideSchema.nullable(),
      isEnded: z.boolean(),
      turn: z.object({ turn: turnStateSchema, at: isoTime }).nullable(),
    })
    .nullable(),
  crew: z.object({ status: crewStatusSchema, attempt: z.int().min(0), startedAt: isoTime.nullable() }).nullable(),
});

export type DeliveryWay = z.infer<typeof deliveryWaySchema>;

/** A reply to a message: the message that answers it, oldest first. */
export const messageReplySchema = z.object({ id: idSchema('message'), sender: partySchema, sentAt: isoTime });

export type MessageReply = z.infer<typeof messageReplySchema>;

/** Output of `fleet.message`: the envelope, the payload, its replies and the delivery with its way and its history, newest first. */
export const messageOutputSchema = listedMessageSchema.omit({ preview: true, delivery: true }).extend({
  payload: z.string(),
  replies: z.array(messageReplySchema),
  delivery: z.object({
    id: idSchema('delivery'),
    state: deliveryStateSchema,
    attempts: z.number().int().nonnegative(),
    claimedBy: partySchema.nullable(),
    way: deliveryWaySchema,
    history: z.array(deliveryHistoryEntrySchema),
  }),
});

export type MessageDetail = z.infer<typeof messageOutputSchema>;

/**
 * Output of `fleet.shipWay`: a ship's side of the way (#756). The open
 * lease's computer side (null: a pull lease, which no trierarch or plugin
 * serves) and its turn as the hooks reported it, then how many deliveries
 * wait for it and the oldest of them, sent first, with its way. No lease while
 * no session crews the ship.
 */
export const shipWayOutputSchema = z.object({
  lease: z
    .object({
      by: computerSideSchema.nullable(),
      turn: z.object({ turn: turnStateSchema, at: isoTime }).nullable(),
    })
    .nullable(),
  waiting: z.int().min(0),
  oldest: z
    .object({
      messageId: idSchema('message'),
      sentAt: isoTime,
      contentType: z.string(),
      delivery: z.object({ id: idSchema('delivery'), state: deliveryStateSchema, attempts: z.int().min(0), way: deliveryWaySchema }),
    })
    .nullable(),
});

export type ShipWay = z.infer<typeof shipWayOutputSchema>;
