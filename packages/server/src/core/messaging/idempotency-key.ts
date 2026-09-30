import { hasNulCharacter, IDEMPOTENCY_KEY_MAX_LENGTH } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/**
 * The sender's own key for one message, so a network retry never sends it
 * twice: 1 to 256 characters of any text but U+0000, taken exactly as given.
 * The rules are shared with the common schema.
 */
export function idempotencyKey(raw: string): Result<string, DomainError<'INVALID_IDEMPOTENCY_KEY'>> {
  if (hasNulCharacter(raw)) {
    return refuse('INVALID_IDEMPOTENCY_KEY', 'An idempotency key cannot hold the character U+0000 (NUL)');
  }
  return raw.length >= 1 && raw.length <= IDEMPOTENCY_KEY_MAX_LENGTH
    ? ok(raw)
    : refuse('INVALID_IDEMPOTENCY_KEY', `An idempotency key is 1 to ${IDEMPOTENCY_KEY_MAX_LENGTH} characters`);
}
