import { z } from 'zod';

import { deliveryStateSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';
import { leaseWakerSchema, messageRecipientSchema, partySchema } from './history.js';
import { isOneLine } from './report.js';

/**
 * Inputs and outputs of receiving and acknowledging deliveries (`ship.receive`
 * and `ship.ack`): how many deliveries a ship takes at once, what it gets for
 * each, and which one it acknowledges; and of the inbox check (`ship.inbox`),
 * which counts what waits without taking any of it.
 */

/** How many deliveries a receive returns when the ship does not say. */
export const RECEIVE_MAX_DEFAULT = 1;

/**
 * The most deliveries one receive returns. The ship chooses up to this many
 * (ADR 0016); the bound keeps one answer at ten 64 KB payloads.
 */
export const RECEIVE_MAX_UPPER_BOUND = 10;

/** Input of `ship.receive`: at most how many deliveries to return, 1 to 10. Without it, one. */
export const receiveInputSchema = z
  .object({ max: z.int().min(1).max(RECEIVE_MAX_UPPER_BOUND).optional() })
  .optional();

export type ReceiveInput = z.infer<typeof receiveInputSchema>;

/**
 * Who a delivery is for, as its message's selector resolved at send time: one
 * ship by its id, or the queue of a type.
 */
export const recipientSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ship'), shipId: idSchema('ship') }),
  z.object({ kind: z.literal('type'), type: z.string() }),
]);

/**
 * One delivery a receive hands the ship, with its message. It stays in flight
 * until the ship acknowledges it; the same crew's next receive returns it
 * again, so the delivery id is the ship's idempotency key.
 */
export const receivedDeliverySchema = z.object({
  deliveryId: idSchema('delivery'),
  messageId: idSchema('message'),
  senderShipId: idSchema('ship'),
  /** The sender's name and type as they are when the delivery is received: a renamed sender goes by its new name. */
  senderName: z.string(),
  senderType: z.string(),
  recipient: recipientSchema,
  payload: z.string(),
  contentType: z.string(),
  /** The model the sender's session stated it runs; null from argo. */
  model: z.string().nullable(),
  /** The message this one replies to, if any. */
  inReplyTo: idSchema('message').nullable(),
  /** When the message was sent. ISO 8601 in UTC. */
  sentAt: z.iso.datetime(),
  /** How many times the delivery has been claimed, this receive included. */
  attempts: z.int().positive(),
  /** Whether its message was sent forced, to act on now (decision 0040). */
  isForced: z.boolean(),
  /** The meeting its message was contributed to or tells of; null outside a meeting (decision 0061). */
  meetingId: idSchema('meeting').nullable(),
  /** The schedule its message was sent for, and that send time; both null on a live send (decision 0062). */
  scheduleId: idSchema('schedule').nullable(),
  sendTime: z.iso.datetime().nullable(),
});

export type ReceivedDelivery = z.infer<typeof receivedDeliverySchema>;

/** Output of `ship.receive`: the deliveries claimed, none when the wait ended without one. */
export const receiveOutputSchema = z.object({
  deliveries: z.array(receivedDeliverySchema).max(RECEIVE_MAX_UPPER_BOUND),
});

export type ReceiveOutput = z.infer<typeof receiveOutputSchema>;

/**
 * Input of `ship.receiveReply`: the message whose reply to receive. Its
 * output is `receiveOutputSchema`, with one delivery at most.
 */
export const receiveReplyInputSchema = z.object({ messageId: idSchema('message') });

export type ReceiveReplyInput = z.infer<typeof receiveReplyInputSchema>;

/**
 * One delivery a push receive takes for the crew's computer side (decision
 * 0040): received, not yet handed to the agent and with no attempt counted,
 * or handed already, with the last hand-over number the crew reported.
 */
export const pushReceivedDeliverySchema = receivedDeliverySchema.extend({
  /** How many times the delivery has been handed over so far: none while it is only received. */
  attempts: z.int().min(0),
  state: z.enum(['received', 'handed']),
  /** The last hand-over number the crew reported with handed; null while received, or when a plain receive handed it. */
  handOverNumber: z.int().positive().nullable(),
});

export type PushReceivedDelivery = z.infer<typeof pushReceivedDeliverySchema>;

/**
 * Input of `ship.pushReceive`: at most how many deliveries to take, 1 to 10,
 * one without it, and what wakes the ship, kept from the lease's first push
 * receive (interop 5.1).
 */
export const pushReceiveInputSchema = z
  .object({ max: z.int().min(1).max(RECEIVE_MAX_UPPER_BOUND).optional(), waker: leaseWakerSchema.optional() })
  .optional();

export type PushReceiveInput = z.infer<typeof pushReceiveInputSchema>;

/** The channel of a hand-over: 1 to 32 of a-z, 0-9, `/`, `.` and `-`, such as `tmux` or `tools/call`. */
const CHANNEL = /^[a-z0-9/.-]{1,32}$/;

/** Output of `ship.pushReceive`: the deliveries taken, none when the wait ended without one. */
export const pushReceiveOutputSchema = z.object({
  deliveries: z.array(pushReceivedDeliverySchema).max(RECEIVE_MAX_UPPER_BOUND),
});

export type PushReceiveOutput = z.infer<typeof pushReceiveOutputSchema>;

/**
 * Input of `ship.handed`: the delivery the computer side handed to the agent,
 * and the number of that hand-over, counting from 1 under the crew's lease.
 * Once more: it hands a confirmed message once more, after the turn that took
 * it died (decision 0040). The channel it handed it through, kept with
 * DeliveryHanded (interop 5.1).
 */
export const handedInputSchema = z.object({
  deliveryId: idSchema('delivery'),
  handOverNumber: z.int().positive(),
  isOnceMore: z.boolean().optional(),
  channel: z.string().regex(CHANNEL, 'A channel is 1 to 32 of a-z, 0-9, /, . and -').optional(),
});

export type HandedInput = z.infer<typeof handedInputSchema>;

/** Output of `ship.handed`: where the delivery stands now. Undeliverable: that was the fifth attempt, and nothing is handed. */
export const handedOutputSchema = z.object({ state: z.enum(['handed', 'acknowledged', 'undeliverable']) });

export type HandedOutput = z.infer<typeof handedOutputSchema>;

/** Input of `ship.handled`: the acknowledged delivery whose turn ended by itself. */
export const handledInputSchema = z.object({ deliveryId: idSchema('delivery') });

export type HandledInput = z.infer<typeof handledInputSchema>;

/** Output of `ship.handled`: nothing; the OK is the answer. */
export const handledOutputSchema = z.strictObject({});

export type HandledOutput = z.infer<typeof handledOutputSchema>;

/** The longest reason a Not handled report may give. */
export const NOT_HANDLED_REASON_MAX_LENGTH = 200;

const REASON_MESSAGE = `A reason is one line of at most ${String(NOT_HANDLED_REASON_MAX_LENGTH)} characters`;

/**
 * Input of `ship.notHandled`: the delivery handed once more whose turn died
 * too, or handed and not confirmed and unsafe to hand again, and why the
 * crew's computer side judged so (#847), which Needs attention shows with the
 * entry. The use case requires the reason for one not confirmed.
 */
export const notHandledInputSchema = z.object({
  deliveryId: idSchema('delivery'),
  reason: z.string().trim().min(1, REASON_MESSAGE).max(NOT_HANDLED_REASON_MAX_LENGTH, REASON_MESSAGE).refine(isOneLine, REASON_MESSAGE).optional(),
});

export type NotHandledInput = z.infer<typeof notHandledInputSchema>;

/** Output of `ship.notHandled`: nothing; the OK is the answer. */
export const notHandledOutputSchema = z.strictObject({});

export type NotHandledOutput = z.infer<typeof notHandledOutputSchema>;

/** Input of `ship.ack`: the delivery the calling ship received and takes responsibility for. */
export const ackInputSchema = z.object({ deliveryId: idSchema('delivery') });

export type AckInput = z.infer<typeof ackInputSchema>;

/** Output of `ship.ack`: nothing; the OK is the answer. */
export const ackOutputSchema = z.strictObject({});

export type AckOutput = z.infer<typeof ackOutputSchema>;

/** The longest an inbox check waits while nothing waits: as long as a receive. */
export const INBOX_WAIT_MAX_SECONDS = 25;

/**
 * Input of `ship.inbox`: how long to wait, 0 to 25 whole seconds, while
 * nothing waits for the crew, or with `knownWaiting` while the count is still
 * the one the crew knows. Without a wait, it answers at once.
 */
export const inboxInputSchema = z
  .object({
    waitSeconds: z.int().min(0).max(INBOX_WAIT_MAX_SECONDS).optional(),
    knownWaiting: z.int().min(0).optional(),
  })
  .optional();

export type InboxInput = z.infer<typeof inboxInputSchema>;

/**
 * Output of `ship.inbox`: how many deliveries the crew's next receive would
 * hand it, and how many of those are forced and not handed over yet: the ones
 * a computer side hands over at once, busy turn or not (decision 0040).
 */
export const inboxOutputSchema = z.object({ waiting: z.int().min(0), forced: z.int().min(0) });

export type InboxOutput = z.infer<typeof inboxOutputSchema>;

/** Input of `ship.delivery`: the delivery the crew reads again. */
export const deliveryInputSchema = z.object({ deliveryId: idSchema('delivery') });

export type DeliveryInput = z.infer<typeof deliveryInputSchema>;

/**
 * Output of `ship.delivery`: an acknowledged delivery of the crew's lease,
 * not yet handled, read again whole, as a receive hands one, with its state.
 */
export const deliveryOutputSchema = receivedDeliverySchema.extend({
  /** How many times the delivery has been claimed, as stored: none when a push receive took it. */
  attempts: z.int().min(0),
  state: deliveryStateSchema,
});

export type DeliveryOutput = z.infer<typeof deliveryOutputSchema>;

/** Input of `ship.sentMessage`: a message the caller sent. */
export const sentMessageInputSchema = z.object({ messageId: idSchema('message') });

export type SentMessageInput = z.infer<typeof sentMessageInputSchema>;

/**
 * Output of `ship.sentMessage`: where each delivery of a message its sender
 * sent stands, and since when, with its ship (null while no ship of a type
 * claimed it): one for a ship or a type, one per ship for a label (decision
 * 0065). Its recipient by name, type or value ids. No payload.
 */
export const sentMessageOutputSchema = z.object({
  messageId: idSchema('message'),
  sentAt: z.iso.datetime(),
  recipient: messageRecipientSchema,
  deliveries: z.array(
    z.object({ deliveryId: idSchema('delivery'), ship: partySchema.nullable(), state: deliveryStateSchema, since: z.iso.datetime() }),
  ),
});

export type SentMessageOutput = z.infer<typeof sentMessageOutputSchema>;
