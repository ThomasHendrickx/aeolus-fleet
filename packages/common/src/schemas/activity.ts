import { z } from 'zod';

import { idSchema } from '../ids/index.js';

/**
 * The kind of a session's latest event as its trierarch observes it
 * (headless design, H14): text, a tool call, a tool result or an error. No
 * content: the fleet holds none of a transcript.
 */
export const ACTIVITY_KINDS = ['text', 'tool', 'result', 'error'] as const;
export const activityKindSchema = z.enum(ACTIVITY_KINDS);
export type ActivityKind = z.infer<typeof activityKindSchema>;

/** The longest a tool call's tool name may be. */
export const ACTIVITY_TOOL_MAX_LENGTH = 100;

/** The most ships one `fleet.reportActivity` writes. */
export const ACTIVITY_SHIPS_MAX = 100;

/** The longest report interval a trierarch may state, in seconds: a day. */
export const ACTIVITY_INTERVAL_MAX_SECONDS = 24 * 60 * 60;

/**
 * Input of `fleet.reportActivity` (crew:run): the report interval the
 * trierarch writes at, in seconds, and per crewed ship it runs its session's
 * latest event: when, its kind, and for a tool call the tool's name
 * (docs/design/monitoring, 4.3).
 */
export const reportActivityInputSchema = z.object({
  intervalSeconds: z.int().min(1).max(ACTIVITY_INTERVAL_MAX_SECONDS),
  activities: z
    .array(
      z.object({
        shipId: idSchema('ship'),
        at: z.iso.datetime(),
        kind: activityKindSchema,
        tool: z.string().trim().min(1).max(ACTIVITY_TOOL_MAX_LENGTH).optional(),
      }),
    )
    .min(1)
    .max(ACTIVITY_SHIPS_MAX),
});

export type ReportActivityInput = z.infer<typeof reportActivityInputSchema>;

/**
 * Output of `fleet.reportActivity`: the entries refused, each with its ship,
 * the refusal's code and message; every other entry was taken.
 */
export const reportActivityOutputSchema = z.object({
  refused: z.array(z.object({ shipId: idSchema('ship'), code: z.string(), message: z.string() })),
});

export type ReportActivityOutput = z.infer<typeof reportActivityOutputSchema>;

/**
 * A crewed ship's activity as the fleet shows it (ISO 8601 in UTC): its
 * session's latest event, when its trierarch wrote it and the report interval
 * it stated, so a reader tells when it reads unknown (`isActivityUnknown`).
 */
export const listedActivitySchema = z.object({
  at: z.iso.datetime(),
  kind: activityKindSchema,
  tool: z.string().nullable(),
  reportedAt: z.iso.datetime(),
  intervalSeconds: z.int().min(1),
});

export type ListedActivity = z.infer<typeof listedActivitySchema>;
