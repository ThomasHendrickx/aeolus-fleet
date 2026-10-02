import { z } from 'zod';

import { liveFleetEventSchema } from './fleet.js';

/** The most events one follow answers, and how many it answers unless told fewer. */
export const FOLLOW_MAX_LIMIT = 100;
export const FOLLOW_MAX_DEFAULT = FOLLOW_MAX_LIMIT;

/** The longest a follow waits while no event has come, in seconds. */
export const FOLLOW_WAIT_MAX_SECONDS = 25;

/**
 * Input of `fleet.follow`: the number of the last event the caller has (the
 * same commit-ordered numbers the console follows by), at most how many to
 * answer, and how long to wait while none has come. Without a position it
 * answers where to start from.
 */
export const followFleetInputSchema = z
  .object({
    afterSeq: z.int().min(0).optional(),
    max: z.int().min(1).max(FOLLOW_MAX_LIMIT).optional(),
    waitSeconds: z.int().min(0).max(FOLLOW_WAIT_MAX_SECONDS).optional(),
  })
  .optional();

export type FollowFleetInput = z.infer<typeof followFleetInputSchema>;

/** Output of `fleet.follow`: the events after the position, oldest first, and the number to follow from next. */
export const followFleetOutputSchema = z.object({
  events: z.array(liveFleetEventSchema),
  lastSeq: z.int().min(0),
});

export type FollowFleetOutput = z.infer<typeof followFleetOutputSchema>;
