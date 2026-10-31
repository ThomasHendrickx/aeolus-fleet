import { crewLineSchema, idSchema, trierarchReportDetailsSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

/**
 * The trierarch plugin's answers as the web app's server parses them
 * (decision 0033): outside data, checked here before any reaches the
 * browser, which imports only the types.
 */

/** A machine as the trierarch plugin lists it: its trierarch's ship, its last report and the details it reported. */
export const machineSchema = z.object({
  shipId: idSchema('ship'),
  name: z.string(),
  status: z.enum(['awaitingCrew', 'crewed']),
  lastSeenAt: z.string().nullable(),
  /** Its trierarch has not been seen for longer than the plugin's threshold. */
  isSilent: z.boolean(),
  report: z.object({ state: z.string(), note: z.string().nullable(), reportedAt: z.string() }).nullable(),
  details: trierarchReportDetailsSchema.nullable(),
});

export type Machine = z.infer<typeof machineSchema>;

/** A joined machine: its trierarch's ship, its starting prompt and crew lines, and its setup line, each shown once. */
export const joinedMachineSchema = z.object({
  shipId: idSchema('ship'),
  name: z.string(),
  prompt: z.string(),
  crewLines: z.array(crewLineSchema),
  setupLine: z.string(),
});

export type JoinedMachine = z.infer<typeof joinedMachineSchema>;

/** A machine's new setup line, with a new secret for its ship, shown once (#1239). */
export const newSetupLineSchema = z.object({ shipId: idSchema('ship'), setupLine: z.string() });

export type NewSetupLine = z.infer<typeof newSetupLineSchema>;

/** What checking crew settings answers: a trierarch fits, none takes them (naming the settings field at fault), or none has room now. */
export const settingsCheckSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fits') }),
  z.object({ kind: z.literal('refused'), field: z.string(), reason: z.string() }),
  z.object({ kind: z.literal('noRoom'), reason: z.string() }),
]);

export type SettingsCheck = z.infer<typeof settingsCheckSchema>;

/** The fleet's enabled models by exact id, as `models.list`, `models.enable` and `models.disable` answer them (decision 0063). */
export const enabledModelsSchema = z.array(z.string());

/** What usage splits by, besides token kind. */
export const usageBreakdownSchema = z.enum(['machine', 'harness', 'model', 'ship', 'login']);

/** The values token usage is narrowed to, per breakdown; a null login is "not reported". */
const usageFiltersSchema = z.object({
  machineShipIds: z.array(idSchema('ship')).optional(),
  harnesses: z.array(z.string()).optional(),
  models: z.array(z.string()).optional(),
  shipIds: z.array(idSchema('ship')).optional(),
  logins: z.array(z.string().nullable()).optional(),
});

/** What the Usage page asks `usage.tokens`: a range on its grain, how to split it, what ranks the series and the filters. */
export const usageTokensRequestSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  splitBy: z.enum([...usageBreakdownSchema.options, 'kind']).nullable(),
  measure: z.enum(['tokens', 'cost']),
  filters: usageFiltersSchema,
});

export type UsageTokensRequest = z.infer<typeof usageTokensRequestSchema>;

/** What the Usage page asks `usage.values`: one breakdown's values in a range, a page at a time. */
export const usageValuesRequestSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  breakdown: usageBreakdownSchema,
  cursor: z.string().nullable(),
});

export type UsageValuesRequest = z.infer<typeof usageValuesRequestSchema>;

const tokenCountsSchema = z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number() });

/** A series' tokens per kind, its estimated cost and its tokens not priced. */
const seriesAmountsSchema = z.object({ tokens: tokenCountsSchema, estimatedCostUsd: z.number(), unpricedTokens: z.number() });

export const TOKEN_KINDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;

/** Token usage as `usage.tokens` answers it: its series named and largest first, each bucket holding usage, and the range's totals. */
export const tokenUsageSchema = z.object({
  grain: z.enum(['hour', 'day']),
  series: z.array(
    z.object({
      key: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('value'), value: z.string().nullable() }),
        z.object({ kind: z.literal('other') }),
        z.object({ kind: z.literal('all') }),
        z.object({ kind: z.literal('tokenKind'), tokenKind: z.enum(TOKEN_KINDS) }),
      ]),
      name: z.string().nullable(),
      amounts: seriesAmountsSchema,
    }),
  ),
  buckets: z.array(z.object({ at: z.iso.datetime(), amounts: z.array(seriesAmountsSchema.extend({ series: z.int().nonnegative() })) })),
  totals: seriesAmountsSchema,
  unpricedModels: z.array(z.string()),
});

export type TokenUsage = z.infer<typeof tokenUsageSchema>;

/** One page of a breakdown's values, as `usage.values` answers it: largest first, a null value for a login not reported. */
export const usageValuesPageSchema = z.object({
  values: z.array(z.object({ value: z.string().nullable(), name: z.string().nullable(), tokens: z.number() })),
  nextCursor: z.string().nullable(),
});

export type UsageValuesPage = z.infer<typeof usageValuesPageSchema>;
