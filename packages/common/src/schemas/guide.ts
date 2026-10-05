import { z } from 'zod';

import { noticeAudienceSchema } from './notice.js';

/** The most steps a guide has. */
export const MAX_GUIDE_STEPS = 10;
/** The most characters of a step's title, after trimming. */
export const GUIDE_STEP_TITLE_MAX = 80;
/** The most characters of a step's text, after trimming. */
export const GUIDE_STEP_TEXT_MAX = 300;
/** The most characters of a step's page. */
const GUIDE_STEP_PATH_MAX = 200;

/**
 * A guide's step (decision 0024): on a console page (its path, such as
 * `/squadrons`), pointing at the element whose `data-testid` is its anchor, or
 * centred on the page without one, with a title and a plain text.
 */
export const guideStepSchema = z.object({
  path: z.string().max(GUIDE_STEP_PATH_MAX).regex(/^\/[^\s]*$/, "A step's page is a console path, such as /squadrons"),
  anchor: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "A step's anchor is an element's data-testid: lowercase letters, digits and hyphens, at most 64")
    .optional(),
  title: z.string().trim().min(1).max(GUIDE_STEP_TITLE_MAX),
  text: z.string().trim().min(1).max(GUIDE_STEP_TEXT_MAX),
});

export type GuideStep = z.infer<typeof guideStepSchema>;

/** The guide: steps, in order, for the console sessions of its audience (the audiences notices have). */
export const guideSchema = z.object({
  audience: noticeAudienceSchema,
  steps: z.array(guideStepSchema).min(1).max(MAX_GUIDE_STEPS),
});

/** Input of `installation.guide.set`: the guide, replacing the one set before; null clears it. */
export const setGuideInputSchema = z.object({ guide: guideSchema.nullable() });

/** Output of `installation.guide.get` and `.set`: the guide as set, or null. */
export const guideOutputSchema = z.object({ guide: guideSchema.nullable() });

/** Where a session is in the guide: open at its step, or skipped or finished, which hides it. */
export const GUIDE_PROGRESS_STATES = ['open', 'skipped', 'finished'] as const;
export type GuideProgressState = (typeof GUIDE_PROGRESS_STATES)[number];

/** A session's progress in the guide: the step it is at, counted from 0, and the guide's state. */
export const guideProgressSchema = z.object({
  step: z.int().min(0),
  state: z.enum(GUIDE_PROGRESS_STATES),
});

/** Input of `console.recordGuideProgress`. */
export const setGuideProgressInputSchema = guideProgressSchema;

/** Output of `console.guide`: the guide's steps and the session's progress, or null when no guide is for the session. */
export const consoleGuideOutputSchema = z.object({ steps: z.array(guideStepSchema), progress: guideProgressSchema }).nullable();
