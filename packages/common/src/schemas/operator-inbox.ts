import { z } from 'zod';

import { deliveryStateSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';
import { partySchema } from './history.js';
import { contentTypeSchema, sendInputSchema } from './message.js';
import { pageInputOf, pageOutputOf } from './page.js';

/**
 * Inputs and outputs of the operator inbox (docs/blueprint.md, "Inbox"): the
 * messages ships sent to argo. Opening one marks it read; read is not done.
 * Mark done or Reply acknowledges it. Only argo's console session calls them.
 */

/** ISO 8601 in UTC. */
const isoTime = z.iso.datetime();

/** Open: not done yet. Done: acknowledged. All: both. */
export const INBOX_FILTERS = ['open', 'done', 'all'] as const;
export const inboxFilterSchema = z.enum(INBOX_FILTERS);
export type InboxFilter = z.infer<typeof inboxFilterSchema>;

/** Input of `fleet.inbox`: the filter, and the cursor and size of a page. */
export const operatorInboxInputSchema = z.object({ filter: inboxFilterSchema, ...pageInputOf(idSchema('delivery')).shape });

/** One message to argo: its delivery's state, when it was read and done, the reply that made it done, argo's replies to it, and the message. */
export const inboxMessageSchema = z.object({
  deliveryId: idSchema('delivery'),
  state: deliveryStateSchema,
  /** When the operator opened it; null while unread. */
  readAt: isoTime.nullable(),
  /** When it was acknowledged; null while open. */
  doneAt: isoTime.nullable(),
  /** The reply that acknowledged it, when a reply did. */
  repliedWith: idSchema('message').nullable(),
  /** Every reply argo sent to it, oldest first: what a console reads an answer from (decision 0038). */
  replies: z.array(z.object({ id: idSchema('message'), contentType: z.string(), payload: z.string(), isPayloadUnreadable: z.boolean(), sentAt: isoTime })),
  message: z.object({
    id: idSchema('message'),
    sender: partySchema,
    inReplyTo: idSchema('message').nullable(),
    sentAt: isoTime,
    contentType: z.string(),
    /** The model the sender's session stated it runs. */
    model: z.string().nullable(),
    payload: z.string(),
    /** Its payload is sealed under a data key that cannot be had now, or does not open: the payload is empty (decision 0068, B9). */
    isPayloadUnreadable: z.boolean(),
    /** Its payload is stored sealed: the console marks it (decision 0068, N1). */
    isPayloadSealed: z.boolean(),
  }),
});

export type InboxMessage = z.infer<typeof inboxMessageSchema>;

/** Output of `fleet.inbox`: a page of the messages to argo the filter keeps, newest first. */
export const operatorInboxOutputSchema = pageOutputOf(inboxMessageSchema, idSchema('delivery'));

/** Input of `fleet.inboxMessage`: one message to argo, by its delivery; answers it as `fleet.inbox` lists it. */
export const inboxMessageInputSchema = z.object({ deliveryId: idSchema('delivery') });

/**
 * Input of `fleet.inboxWithdrawals`: a question's uuid (decision 0038), and
 * the cursor and size of a page of the messages to argo that withdraw or
 * replace it, oldest first; answers as `fleet.inbox` does.
 */
export const inboxWithdrawalsInputSchema = z.object({ questionId: z.uuid(), ...pageInputOf(idSchema('delivery')).shape });

/** Input of `fleet.markRead`: a delivery to argo, read or unread again. */
export const markReadInputSchema = z.object({ deliveryId: idSchema('delivery'), isRead: z.boolean() });

/** Output of `fleet.inboxCount`: how many messages to argo are open, for the navigation and the Open segment. */
export const inboxCountOutputSchema = z.object({ open: z.int().nonnegative() });

/** Output of `fleet.markRead` and `fleet.markDone`: nothing; the OK is the answer. */
export const inboxActionOutputSchema = z.strictObject({});

/** Input of `fleet.markDone`: a delivery to argo, acknowledged without a reply. */
export const markDoneInputSchema = z.object({ deliveryId: idSchema('delivery') });

/**
 * Input of `fleet.reply`: an answer to a message sent to argo, named by its
 * delivery, to its sender, as plain text unless it says another content type,
 * which also marks the message done.
 */
export const replyInputSchema = z.object({
  deliveryId: idSchema('delivery'),
  payload: sendInputSchema.shape.payload,
  contentType: contentTypeSchema.optional(),
  idempotencyKey: sendInputSchema.shape.idempotencyKey,
});

/** Output of `fleet.reply`: the reply. */
export const replyOutputSchema = z.object({ messageId: idSchema('message') });
