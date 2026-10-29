import { z } from 'zod';

import { idSchema } from '../ids/index.js';

/** The longest company key reference taken: an AWS KMS key ARN or alias ARN fits well within it. */
const COMPANY_KEY_MAX_LENGTH = 2048;

/** Input of `fleet.turnOnSealing` (decision 0068): the company key, by its reference in the company's own KMS. */
export const turnOnSealingInputSchema = z.strictObject({ companyKey: z.string().min(1).max(COMPANY_KEY_MAX_LENGTH) });

/** Output of `fleet.turnOnSealing`: sealing while payloads stored plain before wait for the sealing pass, else sealed. */
export const turnOnSealingOutputSchema = z.object({ state: z.enum(['sealing', 'sealed']), companyKey: z.string() });

/** Why the company key vault refused a sealed fleet's company key (decision 0068, B11). */
export const companyKeyUnavailableReasonSchema = z.enum(['accessDenied', 'disabled', 'notFound', 'unreachable']);

/** Whether the company key answered the fleet's last unwrap, and since when; the key vault's reason while it refuses. */
export const keyAvailabilitySchema = z.discriminatedUnion('isAvailable', [
  z.object({ isAvailable: z.literal(true), since: z.iso.datetime() }),
  z.object({ isAvailable: z.literal(false), reason: companyKeyUnavailableReasonSchema, since: z.iso.datetime() }),
]);

/**
 * Output of `fleet.sealing` (decision 0068, B5): none for a fleet that is not
 * sealed; else its state, its company key by reference, the key's
 * availability and its data keys oldest first, each with when it was made and
 * whether it seals now. Never a key, wrapped or not.
 */
export const sealingOutputSchema = z.union([
  z.object({ state: z.literal('none') }),
  z.object({
    state: z.enum(['sealing', 'sealed']),
    companyKey: z.string(),
    keyAvailability: keyAvailabilitySchema,
    dataKeys: z.array(z.object({ id: idSchema('dataKey'), createdAt: z.iso.datetime(), isCurrent: z.boolean() })),
  }),
]);
