import { z } from 'zod';

import { idSchema } from '../ids/index.js';

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
});

export type ReceivedDelivery = z.infer<typeof receivedDeliverySchema>;

/** Output of `ship.receive`: the deliveries claimed, none when the wait ended without one. */
export const receiveOutputSchema = z.object({
  deliveries: z.array(receivedDeliverySchema).max(RECEIVE_MAX_UPPER_BOUND),
});

export type ReceiveOutput = z.infer<typeof receiveOutputSchema>;

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
 * nothing waits for the crew. Without it, it answers at once.
 */
export const inboxInputSchema = z
  .object({ waitSeconds: z.int().min(0).max(INBOX_WAIT_MAX_SECONDS).optional() })
  .optional();

export type InboxInput = z.infer<typeof inboxInputSchema>;

/** Output of `ship.inbox`: how many deliveries the crew's next receive would hand it. */
export const inboxOutputSchema = z.object({ waiting: z.int().min(0) });

export type InboxOutput = z.infer<typeof inboxOutputSchema>;
