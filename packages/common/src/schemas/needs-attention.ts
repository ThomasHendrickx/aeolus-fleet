import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { messageRecipientSchema, partySchema } from './history.js';
import { pageInputOf, pageOutputOf } from './page.js';

/**
 * Inputs and outputs of Needs attention (docs/blueprint.md, 'Domain events'):
 * the undeliverable and not handled deliveries, oldest first, which the
 * operator resends or dismisses. The list reads with fleet:read; resend and dismiss need
 * fleet:manage.
 */

/** ISO 8601 in UTC. */
const isoTime = z.iso.datetime();

/** The states Needs attention lists. Undeliverable: handed again and again, never acknowledged. Not handled: acknowledged, and its turn died twice (decision 0040). */
export const needsAttentionStateSchema = z.enum(['undeliverable', 'notHandled']);

/** One delivery in Needs attention: its state, its claims, since when, and its whole message. */
export const needsAttentionDeliverySchema = z.object({
  deliveryId: idSchema('delivery'),
  state: needsAttentionStateSchema,
  /** The claims counted. */
  attempts: z.int().min(0),
  /** A pushed crew's computer side handed it over, with numbers; false when plain receives handed it (pulled). */
  isPushed: z.boolean(),
  /** When it became undeliverable, or was reported not handled. */
  since: isoTime,
  /** Why its crew reported it not handled, as the crew said (#847); null when undeliverable, or when the crew gave none. */
  reason: z.string().nullable(),
  /** The ship whose attempt made it undeliverable, or whose turn did not handle it: its ship page lists it. */
  ship: partySchema,
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
    /** Its payload is sealed under a data key that cannot be had now, or does not open: the payload is empty (decision 0068, B9). */
    isPayloadUnreadable: z.boolean(),
  }),
});

export type NeedsAttentionDelivery = z.infer<typeof needsAttentionDeliverySchema>;

/** Input of `fleet.needsAttention`: the fleet's, or one ship's for its page, in either state or one, and the cursor and size of a page. */
export const needsAttentionInputSchema = z.object({ shipId: idSchema('ship').optional(), state: needsAttentionStateSchema.optional(), ...pageInputOf(idSchema('delivery')).shape });

/** Output of `fleet.needsAttention`: a page of the undeliverable or not handled deliveries, oldest first by since when. */
export const needsAttentionOutputSchema = pageOutputOf(needsAttentionDeliverySchema, idSchema('delivery'));

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
