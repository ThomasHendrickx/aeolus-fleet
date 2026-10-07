import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { shipHandleSchema } from '../schemas/fleet.js';
import { SHIP_LABELS_MAX } from '../schemas/label.js';
import { harnessSchema } from '../schemas/ship.js';
import { trierarchNameSchema } from './names.js';

const utf8 = new TextEncoder();

/** The longest first prompt, in UTF-8 bytes: 8 KB, given on the first start only. */
export const FIRST_PROMPT_MAX_BYTES = 8192;

/** A new git worktree of a configured repository, or a configured folder used as it is: named, never a path. */
export const trierarchWorkspaceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('worktree'), repository: trierarchNameSchema, ref: z.string().min(1).optional() }),
  z.strictObject({ kind: z.literal('folder'), name: trierarchNameSchema }),
]);
export type TrierarchWorkspace = z.infer<typeof trierarchWorkspaceSchema>;

/**
 * A crew request's settings as a trierarch reads them (decision 0027): the
 * fixed core of harness, workspace, an optional squadron, an optional first
 * prompt and options. The server stores them without meaning; the trierarch
 * plugin and the trierarch parse them with this schema. Never a path or a
 * command-line flag: a workspace names a repository or folder, options pick
 * named settings, and a first prompt never starts with `-`.
 */
export const crewSettingsSchema = z.strictObject({
  harness: harnessSchema,
  workspace: trierarchWorkspaceSchema,
  /** The squadron the ship is a member of, so it checks in at its flagship as a crew line's squadron id does. */
  squadron: shipHandleSchema.optional(),
  firstPrompt: z
    .string()
    .min(1)
    .refine((prompt) => utf8.encode(prompt).byteLength <= FIRST_PROMPT_MAX_BYTES, `A first prompt is at most ${String(FIRST_PROMPT_MAX_BYTES)} bytes`)
    // A harness would read it as a flag the operator never configured (decision 0027).
    .refine((prompt) => !prompt.startsWith('-'), 'A first prompt may not start with -, which reads as a flag')
    .optional(),
  /** Named settings, checked against the JSON Schema the trierarch reports for the harness. */
  options: z.record(z.string(), z.json()),
  /**
   * The label values a machine carries every one of for the request to go to
   * it (#102; docs/trierarch.md, "Machine labels"): exact matches, AND. A
   * machine carries at most 20, so no more can match. None: any machine.
   */
  machineLabels: z.array(idSchema('labelValue')).max(SHIP_LABELS_MAX).optional(),
});

export type CrewSettings = z.infer<typeof crewSettingsSchema>;
