import { RECEIVE_MAX_DEFAULT, RECEIVE_MAX_UPPER_BOUND } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/**
 * How many deliveries a receive returns at most: the ship chooses, 1 to 10,
 * and gets one when it does not say (ADR 0016: the fleet does not decide for
 * the ship).
 */
export function receiveMax(max: number | undefined): Result<number, DomainError<'INVALID_RECEIVE_MAX'>> {
  if (max === undefined) {
    return ok(RECEIVE_MAX_DEFAULT);
  }
  return Number.isInteger(max) && max >= 1 && max <= RECEIVE_MAX_UPPER_BOUND
    ? ok(max)
    : refuse('INVALID_RECEIVE_MAX', `A receive returns 1 to ${RECEIVE_MAX_UPPER_BOUND} deliveries at once`);
}
