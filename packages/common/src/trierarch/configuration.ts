import { z } from 'zod';

import { harnessSchema } from '../schemas/ship.js';
import { trierarchNameSchema } from './names.js';

/**
 * The trierarch's local configuration (docs/architecture.md, "The
 * trierarch"): `~/.aeolus/trierarch/config.json`, written by the operator.
 * Paths and flags live here and only here; messages name what it holds.
 * The trierarch adds no flag by itself.
 */

const placeSchema = z.strictObject({ path: z.string().min(1) });

/** An option a crew request's settings may set: its values by name, each with the flags it adds, and the value used when the settings set none. */
const optionSchema = z
  .strictObject({ values: z.record(trierarchNameSchema, z.array(z.string())), default: trierarchNameSchema.optional() })
  .refine((option) => option.default === undefined || option.default in option.values, {
    message: 'The default is one of the values',
    path: ['default'],
  });

const harnessConfigurationSchema = z.strictObject({
  /** Flags every launch of the harness gets: the operator's choice, with no policy on which. */
  flags: z.array(z.string()),
  options: z.record(trierarchNameSchema, optionSchema),
});

export const trierarchConfigurationSchema = z.strictObject({
  $schema: z.string().optional(),
  /** Where worktrees go, one folder per ship; `~/.aeolus/trierarch/worktrees/` when left out. */
  worktreeRoot: z.string().min(1).optional(),
  caps: z.strictObject({ ships: z.int().positive(), running: z.int().positive() }),
  repositories: z.record(trierarchNameSchema, placeSchema),
  folders: z.record(trierarchNameSchema, placeSchema),
  harnesses: z.record(harnessSchema, harnessConfigurationSchema),
});
export type TrierarchConfiguration = z.infer<typeof trierarchConfigurationSchema>;
