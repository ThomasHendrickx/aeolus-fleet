import { z } from 'zod';

/** The longest company key reference taken: an AWS KMS key ARN or alias ARN fits well within it. */
const COMPANY_KEY_MAX_LENGTH = 2048;

/** Input of `fleet.turnOnSealing` (decision 0068): the company key, by its reference in the company's own KMS. */
export const turnOnSealingInputSchema = z.strictObject({ companyKey: z.string().min(1).max(COMPANY_KEY_MAX_LENGTH) });

/** Output of `fleet.turnOnSealing`: sealing while payloads stored plain before wait for the sealing pass, else sealed. */
export const turnOnSealingOutputSchema = z.object({ state: z.enum(['sealing', 'sealed']), companyKey: z.string() });
