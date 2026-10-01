import {
  LOCATION_DESCRIPTION_MAX_LENGTH,
  type FleetId,
  type LeaseId,
  type LocationKind,
  type ShipId,
} from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Err, type Result } from '../shared/result.js';

/**
 * Where the session crewing a ship runs, reported when it claims the ship.
 * Metadata only: never interpreted. `OTHER` carries a short description; the
 * other kinds carry none.
 */
export interface Location {
  kind: LocationKind;
  description: string | null;
}

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

/** Versioned prefix of every crew token (ADR 0015). */
export const CREW_TOKEN_PREFIX = 'aeolus_ct_v1_';

/** The exclusive right of one session to crew a ship. Open until `endedAt` is set. */
export interface Lease {
  id: LeaseId;
  fleetId: FleetId;
  shipId: ShipId;
  location: Location;
  /**
   * The hash of the crew token `register` gave the session: every later ship
   * call carries the token (ADR 0015). Null for a console session's lease on
   * argo, whose token lives with the console session.
   */
  crewTokenHash: string | null;
  startedAt: Date;
  endedAt: Date | null;
}

/**
 * Why a lease ended; recorded on its LeaseRevoked event. The operator released
 * or retired the ship, its crew deregistered, or, for argo, a sign-in took it
 * over, the operator signed out or the password was reset.
 */
export type LeaseEndReason = 'released' | 'retired' | 'deregistered' | 'takenOver' | 'signedOut' | 'passwordReset';

export type LeaseEnded = DomainError<'LEASE_ENDED'>;

/**
 * The refusal for a crew whose lease has ended: its crew token no longer
 * crews the ship, which needs a new crew with a new starting prompt.
 */
export function refuseEndedLease(): Err<LeaseEnded> {
  return refuse('LEASE_ENDED', 'This ship was released; this session no longer crews it.');
}
