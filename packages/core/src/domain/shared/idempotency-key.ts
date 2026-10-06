import { IDEMPOTENCY_KEY_MAX_LENGTH } from '@aeolus-fleet/common';

import { refuse, type DomainError } from './errors.js';
import { ok, type Result } from './result.js';

/**
 * The caller's own key for one message or one commission, so a network retry
 * never does it twice: 1 to 256 characters of any text, taken exactly as
 * given. The rule is shared with the common schema.
 */
export function idempotencyKey(raw: string): Result<string, DomainError<'INVALID_IDEMPOTENCY_KEY'>> {
  return raw.length >= 1 && raw.length <= IDEMPOTENCY_KEY_MAX_LENGTH
    ? ok(raw)
    : refuse('INVALID_IDEMPOTENCY_KEY', `An idempotency key is 1 to ${IDEMPOTENCY_KEY_MAX_LENGTH} characters`);
}
