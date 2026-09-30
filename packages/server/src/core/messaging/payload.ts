import { hasNulCharacter, PAYLOAD_MAX_BYTES, payloadBytes } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/**
 * A message's payload: text, opaque to the fleet, which never reads, parses or
 * changes it. At most 64 KB serialized, counted in UTF-8 bytes (ADR 0006): a
 * message carries a reference and an instruction, not the content itself.
 * Never the character U+0000, which Postgres text cannot store. The rules are
 * shared with the common schema, so the door checks the same thing.
 */
export function payload(text: string): Result<string, DomainError<'INVALID_PAYLOAD' | 'PAYLOAD_TOO_LARGE'>> {
  if (hasNulCharacter(text)) {
    return refuse('INVALID_PAYLOAD', 'A payload cannot hold the character U+0000 (NUL)');
  }
  const bytes = payloadBytes(text);
  return bytes <= PAYLOAD_MAX_BYTES
    ? ok(text)
    : refuse('PAYLOAD_TOO_LARGE', `A payload is at most ${PAYLOAD_MAX_BYTES} bytes (64 KB) in UTF-8, not ${bytes}`);
}
