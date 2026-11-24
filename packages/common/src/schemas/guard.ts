import { z } from 'zod';

import { trierarchNameSchema } from '../trierarch/names.js';

/** The maximum number of most recent refusals kept in a guard report. */
export const GUARD_RECENT_REFUSALS_MAX = 20;

/** Applied rules and recent refusals, reported by the trierarch. Core stores facts only. */
export const guardStatusSchema = z.object({
  sets: z.array(z.object({ name: trierarchNameSchema, repository: z.string().min(1), commit: z.string().min(1), floor: z.boolean() })),
  refusals: z.int().nonnegative(),
  recent: z.array(z.object({ at: z.iso.datetime(), tool: z.string().min(1), rule: z.string().min(1), set: trierarchNameSchema.nullable(), commit: z.string().min(1).nullable() })).max(GUARD_RECENT_REFUSALS_MAX),
});

export type GuardStatus = z.infer<typeof guardStatusSchema>;
