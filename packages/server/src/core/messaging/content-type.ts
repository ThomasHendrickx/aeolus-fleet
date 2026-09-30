import { CONTENT_TYPE_MAX_LENGTH, isMediaType } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/**
 * What a payload's text is, as its sender says: any well-formed media type,
 * taken exactly as given and passed on untouched. The fleet never reads the
 * payload by it and allows no list of its own (ADR 0016). The rule is shared
 * with the common schema.
 */
export function contentType(raw: string): Result<string, DomainError<'INVALID_CONTENT_TYPE'>> {
  return raw.length <= CONTENT_TYPE_MAX_LENGTH && isMediaType(raw)
    ? ok(raw)
    : refuse(
        'INVALID_CONTENT_TYPE',
        `A content type is a media type such as text/plain or application/json; charset=utf-8, of at most ${CONTENT_TYPE_MAX_LENGTH} characters`,
      );
}
