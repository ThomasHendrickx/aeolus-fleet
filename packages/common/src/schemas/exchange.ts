import { z } from 'zod';

import { deliveryStateSchema, shipKindSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';
import { RECORD_PAGE_SIZE_MAX } from '../rules/page-size.js';
import { pageOutputOf } from './page.js';

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
 * where the other ship's delivery of it stands; on one it received, the
 * caller's own delivery of it. In a sealed fleet a payload
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
  /** The caller's own delivery of a message it received, its id and state, whatever the state; null on the caller's own messages. */
  receivedDelivery: z.object({ deliveryId: idSchema('delivery'), state: deliveryStateSchema }).nullable(),
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

/** Input of `ship.exchanges`: the cursor the last page answered, none for the newest, and the page size (E10). */
export const exchangesInputSchema = z
  .object({ cursor: idSchema('message').optional(), limit: z.int().min(1).max(RECORD_PAGE_SIZE_MAX).optional() })
  .optional();

export type ExchangesInput = z.infer<typeof exchangesInputSchema>;

/**
 * One exchange of `ship.exchanges`: the other ship by id with its current
 * name, type and kind (E2), how many of its messages to the caller are not
 * yet acknowledged, of any content type (E5), and the newest message between
 * them, whole.
 */
export const exchangesEntrySchema = z.object({
  otherShipId: idSchema('ship'),
  otherShipName: z.string(),
  otherShipType: z.string(),
  otherShipKind: shipKindSchema,
  unacknowledged: z.int().min(0),
  newestMessage: z.object({
    messageId: idSchema('message'),
    senderShipId: idSchema('ship'),
    payload: z.string(),
    isPayloadUnreadable: z.boolean(),
    contentType: z.string(),
    /** When the message was sent. ISO 8601 in UTC. */
    sentAt: z.iso.datetime(),
  }),
});

/** Output of `ship.exchanges`: a page of exchanges, newest first, and the cursor of the next; null on the last. */
export const exchangesOutputSchema = pageOutputOf(exchangesEntrySchema, idSchema('message'));

export type ExchangesOutput = z.infer<typeof exchangesOutputSchema>;

/** Input of `ship.ackUpTo`: the other ship, and the message of it to the caller to mark the exchange seen up to (E6). */
export const ackUpToInputSchema = z.object({ otherShipId: idSchema('ship'), messageId: idSchema('message') });

export type AckUpToInput = z.infer<typeof ackUpToInputSchema>;

/** Output of `ship.ackUpTo`: how many deliveries it acknowledged; none again. */
export const ackUpToOutputSchema = z.object({ acknowledged: z.int().min(0) });

export type AckUpToOutput = z.infer<typeof ackUpToOutputSchema>;
