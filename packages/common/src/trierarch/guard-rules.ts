import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { trierarchNameSchema } from './names.js';

/** Resolved rules travel before every assignment, including when no sets apply. */
export const TRIERARCH_GUARD_RULES_CONTENT_TYPE = 'application/vnd.aeolus.trierarch.guard-rules+json';

const commandSchema = z.strictObject({ command: z.string().min(1), args: z.array(z.string()).optional() });
const commandListsSchema = z.strictObject({ allow: z.array(commandSchema).optional(), deny: z.array(commandSchema).optional() });
const gitActionSchema = z.enum(['push', 'force-push', 'skip-hooks', 'rewrite-history', 'delete-branch', 'change-remote', 'change-config']);
// Globs narrow repository-relative writes; absolute paths and parent segments cannot name that boundary.
const writeGlobSchema = z.string().min(1).regex(/^(?![/\\])(?![A-Za-z]:)(?!.*(?:^|[/\\])\.\.(?:[/\\]|$)).+$/, 'A write glob is relative to a repository and contains no parent segment');
const toolSchema = z.string().regex(/^(?:shell|file-write|file-read|web|agent|mcp:[^/\s]+\/[^/\s]+)$/, 'A tool is a harness-neutral kind or mcp:<server>/<tool> with optional star globs');

/** The inner rules block of section 4.1; each type is optional and unknown fields are refused. */
export const guardRulesSchema = z.strictObject({
  commands: commandListsSchema.optional(),
  git: z.strictObject({ deny: z.array(gitActionSchema).optional() }).optional(),
  writePaths: z.strictObject({ allow: z.array(writeGlobSchema).optional(), deny: z.array(writeGlobSchema).optional() }).optional(),
  tools: z.strictObject({ allow: z.array(toolSchema).optional(), deny: z.array(toolSchema).optional() }).optional(),
});

/** A YAML rule-set document. The plugin also checks file-name agreement and the 64 KB source-byte limit. */
export const guardRuleSetSchema = z.strictObject({
  name: trierarchNameSchema,
  description: z.string().optional(),
  rules: guardRulesSchema.optional(),
});

/** Editors validate the same document as the plugin and trierarch. */
export const guardRuleSetJsonSchema = z.toJSONSchema(guardRuleSetSchema);

/** Section 4.4: full resolved rules pinned to this ship's settings version, without repository credentials. */
export const trierarchGuardRulesMessageSchema = z.strictObject({
  fleetId: idSchema('fleet'),
  pluginShipId: idSchema('ship'),
  shipId: idSchema('ship'),
  settingsVersion: z.int().positive(),
  sets: z.array(z.strictObject({
    name: trierarchNameSchema,
    repository: z.string().min(1),
    commit: z.string().min(1),
    file: z.string().min(1),
    floor: z.boolean(),
    rules: guardRulesSchema,
  })),
});

export type GuardRules = z.infer<typeof guardRulesSchema>;
export type GuardRuleSet = z.infer<typeof guardRuleSetSchema>;
export type TrierarchGuardRulesMessage = z.infer<typeof trierarchGuardRulesMessageSchema>;
