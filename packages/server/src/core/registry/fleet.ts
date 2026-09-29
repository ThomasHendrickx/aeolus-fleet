import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/** The tenant: one operator's ships, messages and history. */
export interface Fleet {
  id: FleetId;
  name: string;
  createdAt: Date;
}

export const FLEET_NAME_MAX_LENGTH = 100;

/** A fleet name is trimmed, and between 1 and 100 characters. */
export function fleetName(raw: string): Result<string, DomainError<'INVALID_FLEET_NAME'>> {
  const name = raw.trim();
  if (name.length === 0 || name.length > FLEET_NAME_MAX_LENGTH) {
    return refuse(
      'INVALID_FLEET_NAME',
      `A fleet name is 1 to ${FLEET_NAME_MAX_LENGTH} characters, not counting spaces around it`,
    );
  }
  return ok(name);
}
