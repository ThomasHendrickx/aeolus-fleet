import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { harnessSchema } from '../schemas/ship.js';
import { trierarchNameSchema } from './names.js';

/** The operating systems a trierarch names its machine by, for the trierarch plugin's os label (#102); any other is left out. */
export const MACHINE_OS = ['macos', 'linux', 'windows'] as const;

/** The architectures a trierarch names its machine by, for the trierarch plugin's arch label (#102); any other is left out. */
export const MACHINE_ARCH = ['arm64', 'amd64'] as const;

/**
 * The details of a trierarch's report (docs/trierarch.md, "What a trierarch
 * reports"; decision 0028): what its machine can do, read from its local
 * configuration and what runs. The trierarch plugin places crew requests
 * from them. No entry per ship: each crew request carries its own status.
 * Every object refuses unknown fields.
 */
export const trierarchReportDetailsSchema = z.strictObject({
  harnesses: z.array(
    z.strictObject({
      harness: harnessSchema,
      /** The JSON Schema a crew request's options for this harness are checked against. */
      options: z.record(z.string(), z.json()),
      /** The flags every launch of this harness gets, as the configuration makes them. */
      flags: z.array(z.string()),
      /**
       * Which of those flags are risky, as the trierarch's adapter for the
       * harness knows them, so a reader needs no harness knowledge (#326).
       * None from a trierarch before 0.20.0, which marked none.
       */
      riskyFlags: z.array(z.string()).optional(),
    }),
  ),
  workspaces: z.strictObject({ repositories: z.array(trierarchNameSchema), folders: z.array(trierarchNameSchema) }),
  /** How many ships the machine crews at most, and how many sessions run at once. */
  caps: z.strictObject({ ships: z.int().positive(), running: z.int().positive() }),
  /** Worktrees kept because they had changes. */
  kept: z.array(z.strictObject({ shipId: idSchema('ship'), path: z.string().min(1) })),
  /** Worktrees under the trierarch's root with no assigned request: reported, never deleted. */
  orphans: z.array(z.strictObject({ path: z.string().min(1) })),
  /**
   * The machine it runs on, for the trierarch plugin to label its ship by
   * (docs/trierarch.md, "Machine labels"): an os or arch outside the known
   * ones is left out. None from a trierarch before 0.20.0.
   */
  machine: z.strictObject({ os: z.enum(MACHINE_OS).optional(), arch: z.enum(MACHINE_ARCH).optional() }).optional(),
  /** The trierarch's own version. */
  version: z.string().min(1),
});

export type TrierarchReportDetails = z.infer<typeof trierarchReportDetailsSchema>;
