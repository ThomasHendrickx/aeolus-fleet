import { z } from 'zod';

import { idSchema } from '../ids/index.js';

const reasonSchema = z.enum(['no-answer', 'timeout', 'unusable-answer']);

const readNameSchema = z.string().max(64).regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/);
const goodReadSchema = z.strictObject({ at: z.iso.datetime(), read: readNameSchema });
const failedReadSchema = goodReadSchema.extend({ reason: reasonSchema });

/** The latest outcomes of counted reads and the first failure of the current outage. */
export const pluginReadsSchema = z.strictObject({
  lastFailed: failedReadSchema.nullable(),
  lastGood: goodReadSchema.nullable(),
  failingSince: failedReadSchema.nullable(),
});

export type PluginReads = z.infer<typeof pluginReadsSchema>;

const readInput = { pluginShipId: idSchema('ship'), read: readNameSchema };

export const recordPluginReadInputSchema = z.strictObject({
  ...readInput,
  outcome: z.enum(['good', 'failed']),
  reason: reasonSchema.optional().describe('Required when outcome is failed. Omit for good.'),
}).transform(({ outcome, reason, ...read }, context) => {
  if (outcome === 'good' && reason === undefined) {
    return { ...read, outcome };
  }
  if (outcome === 'failed' && reason !== undefined) {
    return { ...read, outcome, reason };
  }
  context.addIssue({ code: 'custom', path: ['reason'], message: 'Give a reason only for a failed read' });
  return z.NEVER;
});

export type RecordPluginReadInput = z.infer<typeof recordPluginReadInputSchema>;

export const recordPluginReadOutputSchema = z.strictObject({});
