import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { harnessSchema } from '../schemas/ship.js';
import { TRIERARCH_NAME_MAX_LENGTH, trierarchNameSchema } from './names.js';

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
/** A folder's name under the trierarch's worktree root, as it is on disk: one name, never a path. */
const worktreeFolderNameSchema = z
  .string()
  .min(1)
  .max(TRIERARCH_NAME_MAX_LENGTH)
  .refine((name) => !/[/\\]/.test(name) && name !== '.' && name !== '..', 'A folder name is one name, never a path');

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
      /** The harness's version, as the trierarch detected it (#365). None from a harness not detected, or a trierarch before 0.20.2. */
      version: z.string().min(1).optional(),
      /** When the trierarch last confirmed this harness's models (ISO 8601 in UTC); null while none is. None with no version. */
      modelsConfirmedAt: z.iso.datetime().nullable().optional(),
    }),
  ),
  workspaces: z.strictObject({ repositories: z.array(trierarchNameSchema), folders: z.array(trierarchNameSchema) }),
  /** How many ships the machine crews at most, and how many sessions run at once. */
  caps: z.strictObject({ ships: z.int().positive(), running: z.int().positive() }),
  /** Worktrees kept because they had changes, by the ship they belonged to and their repository: paths stay on the machine (decision 0032). */
  kept: z.array(z.strictObject({ shipId: idSchema('ship'), repository: trierarchNameSchema })),
  /** Worktrees under the trierarch's root with no assigned request: reported, never deleted. */
  orphans: z.array(z.strictObject({ repository: worktreeFolderNameSchema, name: worktreeFolderNameSchema })),
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
