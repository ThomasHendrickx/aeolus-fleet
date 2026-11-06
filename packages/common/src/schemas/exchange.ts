import { z } from 'zod';

import { deliveryStateSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';
import { RECORD_PAGE_SIZE_MAX } from '../rules/page-size.js';

/**
 * The exchange read (docs/design/exchange-read): what the calling ship and
 * one other ship said to each other, both ways, newest first, a page at a
 * time, as many as a page of the record holds (E10).
 */

/**
 * Input of `ship.exchange`: the other ship by id (E2), and at most one of a
 * cursor to page older (`before`) or newer (`after`) from, or a message to
 * open the page around; none for the newest page.
 */
export const exchangeInputSchema = z
  .object({
    otherShipId: idSchema('ship'),
    before: idSchema('delivery').optional(),
    after: idSchema('delivery').optional(),
    around: idSchema('message').optional(),
    limit: z.int().min(1).max(RECORD_PAGE_SIZE_MAX).optional(),
  })
  .refine((input) => [input.before, input.after, input.around].filter((from) => from !== undefined).length <= 1, 'Pass at most one of before, after and around');

export type ExchangeInput = z.infer<typeof exchangeInputSchema>;

/**
 * One message of an exchange: whole, from either ship; on the caller's own,
 * where the other ship's delivery of it stands. In a sealed fleet a payload
 * whose data key cannot be had is empty and marked unreadable (decision 0068, B9).
 */
export const exchangeEntrySchema = z.object({
  messageId: idSchema('message'),
  senderShipId: idSchema('ship'),
  payload: z.string(),
  isPayloadUnreadable: z.boolean(),
  contentType: z.string(),
  inReplyTo: idSchema('message').nullable(),
  /** When the message was sent. ISO 8601 in UTC. */
  sentAt: z.iso.datetime(),
  /** Where the other ship's delivery of the caller's own message stands; null on the other ship's messages. */
  deliveryState: deliveryStateSchema.nullable(),
});

/**
 * Output of `ship.exchange`: a page of messages, newest first; the cursor to
 * pass as `before` for the older ones and as `after` for the newer ones, each
 * null while none lie that way.
 */
export const exchangeOutputSchema = z.object({
  items: z.array(exchangeEntrySchema),
  olderCursor: idSchema('delivery').nullable(),
  newerCursor: idSchema('delivery').nullable(),
});

export type ExchangeOutput = z.infer<typeof exchangeOutputSchema>;
