import { z } from 'zod';

import { ARGO_HEADLINE_MAX_LENGTH } from '../fleet/argo-message.js';
import { essenceOf } from './content-type.js';

/**
 * Notices as messages (docs/design/bridge, CC15): a ship tells a person
 * something without asking (a PR opened, a release out) by sending the
 * person's ship a message of the notice content type. The payload is data
 * only: the fleet carries it as any message. Not the installation's notices
 * above the console's pages (notice.ts).
 */
export const NOTICE_CONTENT_TYPE = 'application/vnd.aeolus.notice+json';

export function isNoticeContentType(contentType: string): boolean {
  return essenceOf(contentType) === NOTICE_CONTENT_TYPE;
}

/** A notice message's link: its label and where it goes (an http(s) URL). */
const noticeMessageLinkSchema = z.object({
  label: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
});

/** A notice message: the headline a feed shows first, a Markdown body, and an optional link. */
export const noticeMessageSchema = z.object({
  headline: z.string().min(1).max(ARGO_HEADLINE_MAX_LENGTH),
  body: z.string(),
  link: noticeMessageLinkSchema.optional(),
});

export type NoticeMessage = z.infer<typeof noticeMessageSchema>;
