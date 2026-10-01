import { INBOX_WAIT_MAX_SECONDS } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/** A second, in the milliseconds the wake-ups wait. */
const SECOND_MS = 1000;

/**
 * How long an inbox check waits while nothing waits, in milliseconds: the
 * crew chooses 0 to 25 whole seconds, as long as a receive at most, and gets
 * no wait when it does not say.
 */
export function inboxWait(waitSeconds: number | undefined): Result<number, DomainError<'INVALID_INBOX_WAIT'>> {
  if (waitSeconds === undefined) {
    return ok(0);
  }
  return Number.isInteger(waitSeconds) && waitSeconds >= 0 && waitSeconds <= INBOX_WAIT_MAX_SECONDS
    ? ok(waitSeconds * SECOND_MS)
    : refuse('INVALID_INBOX_WAIT', `An inbox check waits 0 to ${INBOX_WAIT_MAX_SECONDS} whole seconds`);
}
