import { z } from 'zod';

import { harnessSchema } from '../schemas/ship.js';
import { trierarchNameSchema } from './names.js';

/**
 * The trierarch's local configuration (docs/architecture.md, "The
 * trierarch"): `~/.aeolus/trierarch/config.json`, written by the operator.
 * Paths and flags live here and only here; messages name what it holds.
 */

/** Never a default (docs/architecture.md): only an option value a want picks by name launches with it. */
export const SKIP_PERMISSIONS_FLAG = '--dangerously-skip-permissions';

const placeSchema = z.strictObject({ path: z.string().min(1) });

/** An option a want may set: its values by name, each with the flags it adds, and the value used when the want sets none. */
const optionSchema = z
  .strictObject({ values: z.record(trierarchNameSchema, z.array(z.string())), default: trierarchNameSchema.optional() })
  .refine((option) => option.default === undefined || option.default in option.values, {
    message: 'The default is one of the values',
    path: ['default'],
  })
  .refine((option) => option.default === undefined || !option.values[option.default]?.includes(SKIP_PERMISSIONS_FLAG), {
    message: `${SKIP_PERMISSIONS_FLAG} is an explicit value, never a default`,
    path: ['default'],
  });

const harnessConfigurationSchema = z.strictObject({
  /** Flags every launch of the harness gets. */
  flags: z.array(z.string()).refine((flags) => !flags.includes(SKIP_PERMISSIONS_FLAG), {
    message: `${SKIP_PERMISSIONS_FLAG} is an explicit value, never a default: make it an option value`,
  }),
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
