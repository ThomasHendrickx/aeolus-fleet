import { z } from 'zod';

import { idSchema } from '../ids/index.js';

/** The longest company key reference taken: an AWS KMS key ARN or alias ARN fits well within it. */
const COMPANY_KEY_MAX_LENGTH = 2048;

/** The longest recovery key taken: an age X25519 recipient is 62 characters. */
const RECOVERY_KEY_MAX_LENGTH = 256;

/** A recovery key as the company gives it: the public half of an `age` X25519 key pair (`age1...`), checked whole by core. */
const recoveryKeySchema = z.string().min(1).max(RECOVERY_KEY_MAX_LENGTH);

/** Input of `fleet.turnOnSealing` (decision 0068): the company key, by its reference in the company's own KMS, and optionally a recovery key. */
export const turnOnSealingInputSchema = z.strictObject({ companyKey: z.string().min(1).max(COMPANY_KEY_MAX_LENGTH), recoveryKey: recoveryKeySchema.optional() });

/** Output of `fleet.turnOnSealing`: sealing while payloads stored plain before wait for the sealing pass, else sealed; the recovery key's fingerprint when one was given. */
export const turnOnSealingOutputSchema = z.object({ state: z.enum(['sealing', 'sealed']), companyKey: z.string(), recoveryKeyFingerprint: z.string().optional() });

/** Input of `fleet.changeCompanyKey` (decision 0068, B13c): the new company key, by its reference in the company's own KMS. */
export const changeCompanyKeyInputSchema = z.strictObject({ companyKey: z.string().min(1).max(COMPANY_KEY_MAX_LENGTH) });

/** Output of `fleet.changeCompanyKey`: the company key that wraps every data key of the fleet now. */
export const changeCompanyKeyOutputSchema = z.object({ companyKey: z.string() });

/** Input of `fleet.changeRecoveryKey` (decision 0068, B13d): the new recovery key, the public half of an `age` X25519 key pair. */
export const changeRecoveryKeyInputSchema = z.strictObject({ recoveryKey: recoveryKeySchema });

/** Output of `fleet.changeRecoveryKey`: the fingerprint of the recovery key every data key of the fleet is wrapped to now. */
export const changeRecoveryKeyOutputSchema = z.object({ recoveryKeyFingerprint: z.string() });

/** Why the company key vault refused a sealed fleet's company key (decision 0068, B11). */
export const companyKeyUnavailableReasonSchema = z.enum(['accessDenied', 'disabled', 'notFound', 'unreachable']);

/** Whether the company key answered the fleet's last unwrap, and since when; the key vault's reason while it refuses. */
export const keyAvailabilitySchema = z.discriminatedUnion('isAvailable', [
  z.object({ isAvailable: z.literal(true), since: z.iso.datetime() }),
  z.object({ isAvailable: z.literal(false), reason: companyKeyUnavailableReasonSchema, since: z.iso.datetime() }),
]);

/**
 * Output of `fleet.sealing` (decision 0068, B5): none for a fleet that is not
 * sealed; else its state, its company key by reference, its recovery key by
 * fingerprint (none when the company set none), the key's availability and its data keys oldest first, each with when it was made and
 * whether it seals now. Never a key, wrapped or not.
 */
export const sealingOutputSchema = z.union([
  z.object({ state: z.literal('none') }),
  z.object({
    state: z.enum(['sealing', 'sealed']),
    companyKey: z.string(),
    recoveryKeyFingerprint: z.string().nullable(),
    keyAvailability: keyAvailabilitySchema,
    dataKeys: z.array(z.object({ id: idSchema('dataKey'), createdAt: z.iso.datetime(), isCurrent: z.boolean() })),
  }),
]);

/** The longest wrapped data key taken, in base64: an AWS KMS ciphertext blob or an age file holding a 256-bit key fits well within it. */
const WRAPPED_DATA_KEY_MAX_LENGTH = 8192;

/** The most data keys a recovery names: a fleet makes one per 30 days, so this lasts it 80 years. */
const RECOVERY_DATA_KEYS_MAX = 1000;

/**
 * Output of `fleet.recoverySet` (decision 0068, B15): the fleet whose
 * encryption context the new wraps name, its recovery key by fingerprint, and
 * each data key oldest first, wrapped to the recovery key alone (an age file,
 * base64) with its check value (HMAC-SHA-256, base64). Only the company's
 * offline private half opens it.
 */
export const recoverySetOutputSchema = z.object({
  fleetId: idSchema('fleet'),
  recoveryKeyFingerprint: z.string(),
  dataKeys: z.array(z.object({ id: idSchema('dataKey'), wrappedByRecoveryKey: z.base64(), checkValue: z.base64() })),
});

/**
 * Input of `fleet.recoverKeys` (decision 0068, B15): the new company key, by
 * its reference in the company's own KMS, and each of the fleet's data keys
 * wrapped under it for this fleet's context (an AWS KMS ciphertext blob,
 * base64), as the recovery command made them on the company's computer.
 */
export const recoverKeysInputSchema = z.strictObject({
  companyKey: z.string().min(1).max(COMPANY_KEY_MAX_LENGTH),
  dataKeys: z.array(z.strictObject({ id: idSchema('dataKey'), wrappedByCompanyKey: z.base64().min(1).max(WRAPPED_DATA_KEY_MAX_LENGTH) })).max(RECOVERY_DATA_KEYS_MAX),
});

/** Output of `fleet.recoverKeys`: the company key that wraps every data key of the fleet now. */
export const recoverKeysOutputSchema = z.object({ companyKey: z.string() });
