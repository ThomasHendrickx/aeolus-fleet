import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { messageRecipientSchema, partySchema } from './history.js';

/**
 * Inputs and outputs of Needs attention (docs/blueprint.md, 'Domain events'):
 * the undeliverable and not handled deliveries, oldest first, which the
 * operator resends or dismisses. The list reads with fleet:read; resend and dismiss need
 * fleet:manage.
 */

/** ISO 8601 in UTC. */
const isoTime = z.iso.datetime();

/** One delivery in Needs attention: its state, its claims, since when, and its whole message. */
export const needsAttentionDeliverySchema = z.object({
  deliveryId: idSchema('delivery'),
  /** Undeliverable: handed again and again, never acknowledged. Not handled: acknowledged, and its turn died twice (decision 0040). */
  state: z.enum(['undeliverable', 'notHandled']),
  /** The claims counted. */
  attempts: z.int().min(0),
  /** When it became undeliverable, or was reported not handled. */
  since: isoTime,
  message: z.object({
    id: idSchema('message'),
    sender: partySchema,
    recipient: messageRecipientSchema,
    inReplyTo: idSchema('message').nullable(),
    sentAt: isoTime,
    contentType: z.string(),
    /** Whether it is a ping, told by its content type: a ping is never resent. */
    isPing: z.boolean(),
    payload: z.string(),
  }),
});

export type NeedsAttentionDelivery = z.infer<typeof needsAttentionDeliverySchema>;

/** Output of `fleet.needsAttention`: every undeliverable or not handled delivery of the fleet, oldest first. */
export const needsAttentionOutputSchema = z.array(needsAttentionDeliverySchema);

/**
 * One delivery argo was told is overdue (decision 0040): the ship whose 10 or
 * 60 minute clock ran out, the state it waits in, which clock, when argo was
 * told, and its whole message. It clears by itself; nothing resends or
 * dismisses it.
 */
export const overdueDeliverySchema = z.object({
  deliveryId: idSchema('delivery'),
  ship: partySchema,
  state: z.enum(['pending', 'received', 'handed']),
  /** Handed and not confirmed, or waiting while the session is idle or busy. */
  clock: z.enum(['notConfirmed', 'idle', 'busy']),
  /** After how long it ran out: 10 or 60. */
  minutes: z.int().min(1),
  toldAt: isoTime,
  message: needsAttentionDeliverySchema.shape.message,
});

export type OverdueDelivery = z.infer<typeof overdueDeliverySchema>;

/** Output of `fleet.overdue`: every overdue delivery of the fleet that still stands, oldest told first. */
export const overdueOutputSchema = z.array(overdueDeliverySchema);

/** Input of `fleet.dismiss`: the undeliverable or not handled delivery the operator lets go. It stays in history, dismissed. */
export const dismissDeliveryInputSchema = z.object({
  deliveryId: idSchema('delivery'),
});

/** Output of `fleet.dismiss`: nothing; the OK is the answer. */
export const dismissDeliveryOutputSchema = z.strictObject({});

/**
 * Input of `fleet.resend`: the undeliverable or not handled delivery to send again, as a new
 * message from the same sender to the same recipient that names the original.
 */
export const resendDeliveryInputSchema = z.object({
  deliveryId: idSchema('delivery'),
});

/** Output of `fleet.resend`: the new message. */
export const resendDeliveryOutputSchema = z.object({
  messageId: idSchema('message'),
});
