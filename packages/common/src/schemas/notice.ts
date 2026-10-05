import { z } from 'zod';

/** Who sees a notice: every console session, the operator's only, or viewer sessions only (decision 0023). */
export const NOTICE_AUDIENCES = ['everyone', 'operators', 'viewers'] as const;
export const noticeAudienceSchema = z.enum(NOTICE_AUDIENCES);
export type NoticeAudience = z.infer<typeof noticeAudienceSchema>;

/** The most notices the installation sets at once. */
export const MAX_NOTICES = 5;
/** The most characters of a notice's text, after trimming. */
export const NOTICE_TEXT_MAX = 300;
/** The most links a notice carries. */
export const MAX_NOTICE_LINKS = 3;
/** The most characters of a link's label, after trimming. */
export const NOTICE_LINK_LABEL_MAX = 40;

/** A notice's id: a handle the installation chooses, unique among its notices. */
const noticeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'A notice id is a handle: lowercase letters, digits and hyphens, at most 64');

/**
 * A notice's link: its label, and where it goes (an http(s) URL), whether it
 * ends the console session first, or both: a link that signs out goes to its
 * URL afterwards, or to sign-in without one.
 */
export const noticeLinkSchema = z
  .object({
    label: z.string().trim().min(1).max(NOTICE_LINK_LABEL_MAX),
    url: z.url({ protocol: /^https?$/ }).optional(),
    isSignOut: z.boolean().optional(),
  })
  .refine((link) => link.url !== undefined || link.isSignOut === true, 'A link goes to a URL, signs out, or both');

export type NoticeLink = z.infer<typeof noticeLinkSchema>;

/** A notice: plain text above every console page for the sessions of its audience, with optional links; dismissible or not. */
export const noticeSchema = z.object({
  id: noticeIdSchema,
  audience: noticeAudienceSchema,
  text: z.string().trim().min(1).max(NOTICE_TEXT_MAX),
  links: z.array(noticeLinkSchema).max(MAX_NOTICE_LINKS).default([]),
  isDismissible: z.boolean().default(false),
});

/** Input of `installation.notices.set`: the notices, in order, replacing those set before; none clears them. */
export const setNoticesInputSchema = z.object({
  notices: z
    .array(noticeSchema)
    .max(MAX_NOTICES)
    .refine((notices) => new Set(notices.map((notice) => notice.id)).size === notices.length, 'Each notice has its own id'),
});

/** Output of `installation.notices.get` and `.set`: the notices as set. */
export const noticesOutputSchema = z.object({ notices: z.array(noticeSchema) });

/** Output of `console.notices`: the notices of the session's audience, less those it dismissed. */
export const consoleNoticesOutputSchema = z.array(noticeSchema);

/** Input of `console.dismissNotice`. */
export const dismissNoticeInputSchema = z.object({ noticeId: noticeIdSchema });
