import { SHIP_NOTE_MAX_LENGTH } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/**
 * The operator's free text about a ship, optional. Whitespace around it is
 * dropped, and a note of only whitespace is no note.
 */
export function shipNote(raw: string | undefined): Result<string | null, DomainError<'INVALID_SHIP_NOTE'>> {
  const note = raw?.trim() ?? '';
  if (note.length > SHIP_NOTE_MAX_LENGTH) {
    return refuse('INVALID_SHIP_NOTE', `A note is at most ${SHIP_NOTE_MAX_LENGTH} characters`);
  }
  return ok(note === '' ? null : note);
}
