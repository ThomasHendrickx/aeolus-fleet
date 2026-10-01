import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { messageRecipientSchema, partySchema } from './history.js';

/**
 * Inputs and outputs of Needs attention (docs/blueprint.md, 'Domain events'):
 * the undeliverable deliveries, oldest first, which the operator resends or
 * dismisses. The list reads with fleet:read; resend and dismiss need
 * fleet:manage.
 */

/** ISO 8601 in UTC. */
const isoTime = z.iso.datetime();

/** One undeliverable delivery: its claims, since when it is undeliverable, and its whole message. */
export const undeliverableDeliverySchema = z.object({
  deliveryId: idSchema('delivery'),
  /** The claims counted, none of them acknowledged. */
  attempts: z.int().min(0),
  /** When it became undeliverable. */
  since: isoTime,
  message: z.object({
    id: idSchema('message'),
    sender: partySchema,
    recipient: messageRecipientSchema,
    inReplyTo: idSchema('message').nullable(),
    sentAt: isoTime,
    contentType: z.string(),
    payload: z.string(),
  }),
});

export type UndeliverableDelivery = z.infer<typeof undeliverableDeliverySchema>;

/** Output of `fleet.needsAttention`: every undeliverable delivery of the fleet, oldest first. */
export const needsAttentionOutputSchema = z.array(undeliverableDeliverySchema);

/** Input of `fleet.dismiss`: the undeliverable delivery the operator lets go. It stays in history, dismissed. */
export const dismissDeliveryInputSchema = z.object({
  deliveryId: idSchema('delivery'),
});

/** Output of `fleet.dismiss`: nothing; the OK is the answer. */
export const dismissDeliveryOutputSchema = z.strictObject({});

/**
 * Input of `fleet.resend`: the undeliverable delivery to send again, as a new
 * message from the same sender to the same recipient that names the original.
 */
export const resendDeliveryInputSchema = z.object({
  deliveryId: idSchema('delivery'),
});

/** Output of `fleet.resend`: the new message. */
export const resendDeliveryOutputSchema = z.object({
  messageId: idSchema('message'),
});
