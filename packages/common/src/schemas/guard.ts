import { z } from 'zod';

import { trierarchNameSchema } from '../trierarch/names.js';

/** Applied rules and the last twenty refusals, reported by the trierarch. Core stores facts only. */
export const guardStatusSchema = z.object({
  sets: z.array(z.object({ name: trierarchNameSchema, repository: z.string().min(1), commit: z.string().min(1), floor: z.boolean() })),
  refusals: z.int().nonnegative(),
  recent: z.array(z.object({ at: z.iso.datetime(), tool: z.string().min(1), rule: z.string().min(1), set: trierarchNameSchema.nullable(), commit: z.string().min(1).nullable() })).max(20),
});

export type GuardStatus = z.infer<typeof guardStatusSchema>;
