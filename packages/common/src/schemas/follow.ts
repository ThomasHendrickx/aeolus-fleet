import { z } from 'zod';

import { liveFleetEventSchema } from './fleet.js';

/** The most events one follow answers, and how many it answers unless told fewer. */
export const FOLLOW_MAX_LIMIT = 100;
export const FOLLOW_MAX_DEFAULT = FOLLOW_MAX_LIMIT;

/**
 * Input of `fleet.follow`: the number of the last event the caller has (the
 * same commit-ordered numbers the console follows by), and at most how many to
 * answer. Without a position it answers where to start from. It answers at
 * once (decision 0072), so a `waitSeconds` is refused as unknown input.
 */
export const followFleetInputSchema = z
  .strictObject({
    afterSeq: z.int().min(0).optional(),
    max: z.int().min(1).max(FOLLOW_MAX_LIMIT).optional(),
  })
  .optional();

export type FollowFleetInput = z.infer<typeof followFleetInputSchema>;

/** Output of `fleet.follow`: the events after the position, oldest first, and the number to follow from next. */
export const followFleetOutputSchema = z.object({
  events: z.array(liveFleetEventSchema),
  lastSeq: z.int().min(0),
});

export type FollowFleetOutput = z.infer<typeof followFleetOutputSchema>;
