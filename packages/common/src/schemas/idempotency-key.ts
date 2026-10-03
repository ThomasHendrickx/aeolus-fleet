import { z } from 'zod';

/** The longest idempotency key a caller may give. It is opaque: any text of 1 to this many characters. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 256;

/** The caller's own key for one send or one commission, so a retry never does it twice. */
export const idempotencyKeySchema = z.string().min(1).max(IDEMPOTENCY_KEY_MAX_LENGTH);
