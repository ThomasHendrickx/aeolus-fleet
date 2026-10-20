import { z } from 'zod';

import { shipKindSchema, shipStatusSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';
import { contentTypeSchema } from './message.js';
import { discoveredVerifiedFactSchema } from './verified-fact.js';

/**
 * A ship's statement (decision 0047): what it is and what it offers, stated
 * by its crew and read by the ships that can send to it. A short summary and
 * capabilities, each borrowing MCP's tool fields (name, title, description,
 * inputSchema, outputSchema, annotations) and A2A's skill fields for media
 * types (inputModes, outputModes), so a later gateway maps them as they are
 * (decision 0048), and what a call through the gateway needs: its wait, its
 * deadline and whether it is repeatable (interop 3.4, 5.2, 5.3). Core checks
 * the shape and acts on none of it.
 */

/** The most a statement holds: 64 KB as the UTF-8 bytes of its JSON, as a payload does (decision 0006). */
export const STATEMENT_MAX_BYTES = 64 * 1024;

/** The longest a statement's summary may be. */
export const STATEMENT_SUMMARY_MAX_LENGTH = 1000;

/** A capability's name as MCP names a tool: 1 to 128 letters, digits, `_`, `-` or `.`. */
const CAPABILITY_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

const CAPABILITY_NAME_MESSAGE = 'A capability name is 1 to 128 letters, digits, _, - or ., as MCP names a tool';

/** A JSON Schema as MCP's tool takes one: a JSON object, never read by the fleet. */
const jsonSchemaSchema = z.record(z.string(), z.json());

/** The longest a capability may ask the gateway to hold an outside call for its reply: 2 minutes (interop 5.3). */
export const CAPABILITY_WAIT_MAX_MS = 120_000;

/** The longest deadline a capability may state for a call: 7 days (interop 3.4). */
export const CAPABILITY_DEADLINE_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/** MCP's tool annotations as MCP defines them: hints a client trusts only from a trusted server. */
const toolAnnotationsSchema = z.strictObject({
  title: z.string().optional(),
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
});

/** Media types, as A2A's skill lists them: at least one, the first the one to use. */
const modesSchema = z.array(contentTypeSchema).min(1, 'Name at least one media type');

/** One thing a ship offers: MCP's tool fields and A2A's input and output modes. */
export const capabilitySchema = z.strictObject({
  name: z.string().regex(CAPABILITY_NAME, CAPABILITY_NAME_MESSAGE),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: jsonSchemaSchema.optional(),
  outputSchema: jsonSchemaSchema.optional(),
  /** The media types to send it, the first the one to use (A2A's skill inputModes). */
  inputModes: modesSchema.optional(),
  /** The media types that come back, the first the one to expect (A2A's skill outputModes). */
  outputModes: modesSchema.optional(),
  /**
   * How long the gateway may hold an outside call for the reply, in
   * milliseconds, capped by its configuration; none is 0, answered at once
   * with a task or a handle (interop 5.3).
   */
  waitMs: z.int().min(0).max(CAPABILITY_WAIT_MAX_MS).optional(),
  /** How long a call may take before the gateway fails it, in milliseconds; none is no deadline (interop 3.4). */
  deadlineMs: z.int().min(1).max(CAPABILITY_DEADLINE_MAX_MS).optional(),
  /** Whether a call that died before it was confirmed may be handed again; none is not (interop 5.2). */
  repeatable: z.boolean().optional(),
  /** MCP's tool annotations, as the outside server gave them. */
  annotations: toolAnnotationsSchema.optional(),
});

export type Capability = z.infer<typeof capabilitySchema>;

const utf8 = new TextEncoder();

/** The size of a statement: the UTF-8 bytes of its JSON. */
export function statementBytes(statement: unknown): number {
  return utf8.encode(JSON.stringify(statement)).byteLength;
}

const STATEMENT_SIZE_MESSAGE = `A statement is at most ${String(STATEMENT_MAX_BYTES)} bytes (64 KB) as JSON in UTF-8`;

/** A statement: a summary and capabilities, each name once, at most 64 KB. */
export const statementSchema = z
  .strictObject({
    summary: z
      .string()
      .trim()
      .min(1, 'A statement has a summary')
      .max(STATEMENT_SUMMARY_MAX_LENGTH, `A summary is at most ${String(STATEMENT_SUMMARY_MAX_LENGTH)} characters`),
    capabilities: z.array(capabilitySchema),
  })
  .refine((statement) => new Set(statement.capabilities.map((capability) => capability.name)).size === statement.capabilities.length, {
    message: 'A statement names each capability once',
    path: ['capabilities'],
  })
  .refine((statement) => statementBytes(statement) <= STATEMENT_MAX_BYTES, { message: STATEMENT_SIZE_MESSAGE });

export type Statement = z.infer<typeof statementSchema>;

/** Input of `setStatement`: the crew's whole statement, replacing the one it stated before. */
export const setStatementInputSchema = statementSchema;

/** Output of `setStatement`: the statement's version now. */
export const setStatementOutputSchema = z.object({ version: z.int().min(1) });

/**
 * A ship's statement as discovery shows it, saying who wrote it: its crew's,
 * with its version, while one is stated; else the note it was commissioned
 * with; else none.
 */
export const discoveredStatementSchema = z
  .discriminatedUnion('by', [
    z.object({ by: z.literal('crew'), version: z.int().min(1), summary: z.string(), capabilities: z.array(capabilitySchema) }),
    z.object({ by: z.literal('commission'), note: z.string() }),
  ])
  .nullable();

export type DiscoveredStatement = z.infer<typeof discoveredStatementSchema>;

/**
 * Output of `discover` (messages:send): the ships the caller may send to now,
 * each with its name, type, kind, status, statement and verified facts, and each type with
 * how many of its ships it reaches (decision 0047). Ships, never rules.
 */
export const discoverOutputSchema = z.object({
  ships: z.array(
    z.object({
      id: idSchema('ship'),
      name: z.string(),
      type: z.string(),
      kind: shipKindSchema,
      status: shipStatusSchema,
      statement: discoveredStatementSchema,
      /** The facts actors checked about it, oldest first, each naming its writer (decision 0059). */
      verified: z.array(discoveredVerifiedFactSchema),
    }),
  ),
  types: z.array(z.object({ type: z.string(), reachable: z.int().min(1) })),
});

export type Discovered = z.infer<typeof discoverOutputSchema>;
