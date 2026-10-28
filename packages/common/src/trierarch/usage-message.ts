import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { harnessSchema } from '../schemas/ship.js';
import { subscriptionReadingSchema } from './report-details.js';

/** The content type of a trierarch's usage message to the trierarch plugin's ship. */
export const TRIERARCH_USAGE_CONTENT_TYPE = 'application/vnd.aeolus.trierarch.usage+json';

/**
 * A timestamp at the start of a UTC hour (ISO 8601 in UTC): a ship's tokens
 * count in the UTC hour each transcript entry happened.
 */
const utcHourSchema = z.iso.datetime().refine((value) => {
  const at = new Date(value);
  return at.getUTCMinutes() === 0 && at.getUTCSeconds() === 0 && at.getUTCMilliseconds() === 0;
}, 'An hour starts a UTC hour');

const tokenCountSchema = z.int().nonnegative();
const costSchema = z.number().nonnegative();

/**
 * The tokens of one model in one hour, each kind with its cost estimated from
 * the trierarch's price table, so the Usage page splits cost by token kind;
 * null for a model the table does not price.
 */
const modelHourUsageSchema = z.strictObject({
  model: z.string().min(1),
  tokens: z.strictObject({ input: tokenCountSchema, output: tokenCountSchema, cacheRead: tokenCountSchema, cacheWrite: tokenCountSchema }),
  estimatedCostUsd: z.strictObject({ input: costSchema, output: costSchema, cacheRead: costSchema, cacheWrite: costSchema }).nullable(),
});

/**
 * The usage a trierarch sends its trierarch plugin's ship (aeolus-fleet's
 * docs/design/usage/usage.md, "What the trierarch sends, and when"): the hours
 * that changed since its last send that returned OK, each whole, and the
 * subscription readings since then. An hour's tokens are its total so far, set,
 * never added. Every object refuses unknown fields.
 */
export const trierarchUsageMessageSchema = z.strictObject({
  hours: z.array(
    z.strictObject({
      hour: utcHourSchema,
      ships: z.array(
        z.strictObject({
          shipId: idSchema('ship'),
          harness: harnessSchema,
          /** When the ship's folder was made on the machine: tells two folders of one ship apart. */
          folderMadeAt: z.iso.datetime(),
          /** The subscription or API key the ship ran on; null while the trierarch names none. */
          login: z.string().min(1).nullable(),
          models: z.array(modelHourUsageSchema),
        }),
      ),
    }),
  ),
  subscriptions: z.array(subscriptionReadingSchema),
  /** When the trierarch read it (ISO 8601 in UTC). */
  readAt: z.iso.datetime(),
});

export type TrierarchUsageMessage = z.infer<typeof trierarchUsageMessageSchema>;
