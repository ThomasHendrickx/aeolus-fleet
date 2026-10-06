import { z } from 'zod';

import { shipHandleSchema } from '../schemas/fleet.js';
import { harnessSchema } from '../schemas/ship.js';
import { FIRST_PROMPT_MAX_BYTES, trierarchWorkspaceSchema } from './protocol.js';

const utf8 = new TextEncoder();

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
});

export type CrewSettings = z.infer<typeof crewSettingsSchema>;
