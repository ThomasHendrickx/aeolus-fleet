import { z } from 'zod';

import { deliveryStateSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';
import { partySchema } from './history.js';
import { sendInputSchema } from './message.js';

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

/** Input of `fleet.inbox`. */
export const operatorInboxInputSchema = z.object({ filter: inboxFilterSchema });

/** One message to argo: its delivery's state, when it was read and done, the reply that made it done, and the message. */
export const inboxMessageSchema = z.object({
  deliveryId: idSchema('delivery'),
  state: deliveryStateSchema,
  /** When the operator opened it; null while unread. */
  readAt: isoTime.nullable(),
  /** When it was acknowledged; null while open. */
  doneAt: isoTime.nullable(),
  /** The reply that acknowledged it, when a reply did. */
  repliedWith: idSchema('message').nullable(),
  message: z.object({
    id: idSchema('message'),
    sender: partySchema,
    inReplyTo: idSchema('message').nullable(),
    sentAt: isoTime,
    contentType: z.string(),
    /** The model the sender's session stated it runs. */
    model: z.string().nullable(),
    payload: z.string(),
  }),
});

export type InboxMessage = z.infer<typeof inboxMessageSchema>;

/** Output of `fleet.inbox`: the messages to argo the filter keeps, newest first. */
export const operatorInboxOutputSchema = z.array(inboxMessageSchema);

/** Input of `fleet.markRead`: a delivery to argo, read or unread again. */
export const markReadInputSchema = z.object({ deliveryId: idSchema('delivery'), isRead: z.boolean() });

/** Output of `fleet.markRead` and `fleet.markDone`: nothing; the OK is the answer. */
export const inboxActionOutputSchema = z.strictObject({});

/** Input of `fleet.markDone`: a delivery to argo, acknowledged without a reply. */
export const markDoneInputSchema = z.object({ deliveryId: idSchema('delivery') });

/**
 * Input of `fleet.reply`: an answer to a message sent to argo, named by its
 * delivery, as plain text to its sender, which also marks the message done.
 */
export const replyInputSchema = z.object({
  deliveryId: idSchema('delivery'),
  payload: sendInputSchema.shape.payload,
  idempotencyKey: sendInputSchema.shape.idempotencyKey,
});

/** Output of `fleet.reply`: the reply. */
export const replyOutputSchema = z.object({ messageId: idSchema('message') });
