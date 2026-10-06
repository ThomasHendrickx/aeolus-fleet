import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { shipHandleSchema } from '../schemas/fleet.js';
import { harnessSchema } from '../schemas/ship.js';
import { trierarchNameSchema } from './names.js';

/**
 * The trierarch protocol (docs/trierarch.md, decision 0027): fleet messages
 * to and from a trierarch's ship. Aeolus reads none of them. The core is
 * fixed for every dispatcher; each harness's options are open, described by
 * the JSON Schema describe answers with. Every message refuses unknown
 * fields, so a dispatcher never ignores what a requester meant.
 */

/** A message's content type, by convention: `application/vnd.aeolus.trierarch.<name>+json`. */
export function trierarchContentType(name: string): string {
  return `application/vnd.aeolus.trierarch.${name}+json`;
}

/** The longest first prompt, in UTF-8 bytes: 8 KB, given on the first start only. */
export const FIRST_PROMPT_MAX_BYTES = 8192;

const utf8 = new TextEncoder();

/** Where an entry stands in the trierarch's loop; running covers idle and busy. */
export const TRIERARCH_ENTRY_STATES = ['wanted', 'crewing', 'running', 'restarting', 'crashed', 'releasing'] as const;
export const trierarchEntryStateSchema = z.enum(TRIERARCH_ENTRY_STATES);
export type TrierarchEntryState = z.infer<typeof trierarchEntryStateSchema>;

const shipIdSchema = idSchema('ship');

/** A new git worktree of a configured repository, or a configured folder used as it is: named, never a path. */
export const trierarchWorkspaceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('worktree'), repository: trierarchNameSchema, ref: z.string().min(1).optional() }),
  z.strictObject({ kind: z.literal('folder'), name: trierarchNameSchema }),
]);
export type TrierarchWorkspace = z.infer<typeof trierarchWorkspaceSchema>;

/** A worktree the trierarch kept because it had changes, until a human or a release with force clears it. */
const keptWorktreeSchema = z.strictObject({ shipId: shipIdSchema, path: z.string().min(1) });

export const describeCommandSchema = z.strictObject({});

/** A flag a harness adapter adds itself, as mechanism, never the operator's: on every launch or on a restart only. */
export const trierarchAdapterFlagSchema = z.strictObject({ flag: z.string().min(1), when: z.enum(['always', 'restart']) });
export type TrierarchAdapterFlag = z.infer<typeof trierarchAdapterFlagSchema>;

export const describedAnswerSchema = z.strictObject({
  harnesses: z.array(
    z.strictObject({
      harness: harnessSchema,
      /** The JSON Schema a want's options are checked against. */
      options: z.record(z.string(), z.json()),
      /** The flags every launch of this harness gets, as the configuration makes them. */
      flags: z.array(z.string()),
      /** The flags the harness's adapter adds itself, beside the configured ones. */
      adapterFlags: z.array(trierarchAdapterFlagSchema),
    }),
  ),
  workspaces: z.strictObject({ repositories: z.array(trierarchNameSchema), folders: z.array(trierarchNameSchema) }),
  caps: z.strictObject({ ships: z.int().positive(), running: z.int().positive() }),
  kept: z.array(keptWorktreeSchema),
  version: z.string().min(1),
});

export const wantCommandSchema = z.strictObject({
  shipId: shipIdSchema,
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
  /** Named settings from what describe offers; checked against its JSON Schema by the trierarch. */
  options: z.record(z.string(), z.json()),
});
export type WantCommand = z.infer<typeof wantCommandSchema>;

export const wantedAnswerSchema = z.strictObject({ shipId: shipIdSchema });

export const refusedAnswerSchema = z.strictObject({
  shipId: shipIdSchema,
  /** The field that was refused, such as `options.model`, when one was. */
  field: z.string().min(1).optional(),
  reason: z.string().min(1),
});

export const releaseCommandSchema = z.strictObject({ shipId: shipIdSchema, force: z.boolean().optional() });

export const releasedAnswerSchema = z.strictObject({
  shipId: shipIdSchema,
  workspace: z.enum(['removed', 'kept']),
  path: z.string().min(1).optional(),
});

export const listCommandSchema = z.strictObject({});

export const listedAnswerSchema = z.strictObject({
  ships: z.array(
    z.strictObject({
      shipId: shipIdSchema,
      harness: harnessSchema,
      state: trierarchEntryStateSchema,
      since: z.iso.datetime(),
      restarts: z.int().nonnegative(),
    }),
  ),
  kept: z.array(keptWorktreeSchema),
  /** Worktrees under the trierarch's root with no entry: reported, never deleted. */
  orphans: z.array(z.strictObject({ path: z.string().min(1) })),
});

export const runningNoticeSchema = z.strictObject({ shipId: shipIdSchema });

export const crashedNoticeSchema = z.strictObject({ shipId: shipIdSchema, exits: z.int().positive() });

export const leaseEndedNoticeSchema = z.strictObject({ shipId: shipIdSchema });

/** The commands, by name: what a requester sends a trierarch. */
export const trierarchCommandSchemas: Readonly<Record<string, z.ZodType>> = {
  describe: describeCommandSchema,
  want: wantCommandSchema,
  release: releaseCommandSchema,
  list: listCommandSchema,
};

/** The answers, by name, each in reply to its command. */
export const trierarchAnswerSchemas: Readonly<Record<string, z.ZodType>> = {
  described: describedAnswerSchema,
  wanted: wantedAnswerSchema,
  refused: refusedAnswerSchema,
  released: releasedAnswerSchema,
  listed: listedAnswerSchema,
};

/** The notices, by name, unasked, to the ship that sent the want. */
export const trierarchNoticeSchemas: Readonly<Record<string, z.ZodType>> = {
  running: runningNoticeSchema,
  crashed: crashedNoticeSchema,
  leaseEnded: leaseEndedNoticeSchema,
};
