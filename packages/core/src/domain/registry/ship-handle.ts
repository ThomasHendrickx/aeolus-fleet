import { SHIP_HANDLE_MAX_LENGTH, SHIP_HANDLE_PATTERN } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/**
 * A ship's name and its type are handles (docs/blueprint.md, "Ship"): 1 to 48
 * lowercase letters, digits, hyphens or colons, taken exactly as given. The
 * rule is shared with the common schema, so the console checks the same thing.
 */
function isShipHandle(value: string): boolean {
  return value.length <= SHIP_HANDLE_MAX_LENGTH && SHIP_HANDLE_PATTERN.test(value);
}

const HANDLE_RULE = `1 to ${SHIP_HANDLE_MAX_LENGTH} lowercase letters, digits, hyphens or colons`;

export function shipName(raw: string): Result<string, DomainError<'INVALID_SHIP_NAME'>> {
  return isShipHandle(raw) ? ok(raw) : refuse('INVALID_SHIP_NAME', `A ship name is ${HANDLE_RULE}`);
}

/** A free label in v1, used for addressing and never interpreted. */
export function shipType(raw: string): Result<string, DomainError<'INVALID_SHIP_TYPE'>> {
  return isShipHandle(raw) ? ok(raw) : refuse('INVALID_SHIP_TYPE', `A ship type is ${HANDLE_RULE}`);
}
