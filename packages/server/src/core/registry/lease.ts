import type { FleetId, LeaseId, LocationKind, ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/**
 * Where the session crewing a ship runs, reported when it claims the ship.
 * Metadata only: never interpreted. `OTHER` carries a short description; the
 * other kinds carry none.
 */
export interface Location {
  kind: LocationKind;
  description: string | null;
}

export const LOCATION_DESCRIPTION_MAX_LENGTH = 100;

export function location(kind: LocationKind, description?: string): Result<Location, DomainError<'INVALID_LOCATION'>> {
  if (kind !== 'OTHER') {
    if (description !== undefined) {
      return refuse('INVALID_LOCATION', `Only an OTHER location carries a description, not ${kind}`);
    }
    return ok({ kind, description: null });
  }

  const trimmed = description?.trim() ?? '';
  if (trimmed.length === 0 || trimmed.length > LOCATION_DESCRIPTION_MAX_LENGTH) {
    return refuse(
      'INVALID_LOCATION',
      `An OTHER location needs a description of 1 to ${LOCATION_DESCRIPTION_MAX_LENGTH} characters`,
    );
  }
  return ok({ kind, description: trimmed });
}

/** The exclusive right of one session to crew a ship. Open until `endedAt` is set. */
export interface Lease {
  id: LeaseId;
  fleetId: FleetId;
  shipId: ShipId;
  location: Location;
  startedAt: Date;
  endedAt: Date | null;
}

/** Why a lease ended; recorded on its LeaseRevoked event. */
export type LeaseEndReason = 'takenOver' | 'signedOut' | 'passwordReset';
