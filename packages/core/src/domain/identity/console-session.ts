import type { ConsoleSessionId, FleetId, LeaseId, ShipId } from '@aeolus-fleet/common';

import type { Location } from '../registry/public.js';

/**
 * A console session: the operator crewing `argo`, or a person viewing the
 * fleet through its viewer ship (decision 0022). Only the hash of the
 * session token is stored; the token lives in the browser's cookie.
 */
export interface ConsoleSession {
  id: ConsoleSessionId;
  fleetId: FleetId;
  shipId: ShipId;
  /** The lease on `argo` this session holds; null for a viewer session, which holds none. */
  leaseId: LeaseId | null;
  /** How long after its last use the session stays valid. */
  idleLimitMs: number;
  /** The moment no use renews it past; null when only idleness ends it. */
  endsBy: Date | null;
  /** The device it signed in from, as the browser told: "Mac · Chrome". */
  device: string;
  tokenHash: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  /** Why the session ended; null while it has not. */
  endReason: ConsoleSessionEndReason | null;
}

/**
 * Why a console session ended: the operator signed in somewhere else and took
 * argo over, signed out, or the password was reset. An expired session never
 * ended; it simply stopped working.
 */
export type ConsoleSessionEndReason = 'takenOver' | 'signedOut' | 'passwordReset';

/** The operator's console session stays valid this long after its last use. */
export const CONSOLE_SESSION_IDLE_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

/** A viewer session stays valid this long after its last use (decision 0022). */
export const VIEWER_SESSION_IDLE_LIMIT_MS = 2 * HOUR_MS;

/** No use renews a viewer session past this long after it started (decision 0022). */
export const VIEWER_SESSION_LIFETIME_MS = 24 * HOUR_MS;

/** The device of a sign-in that named none. */
export const UNKNOWN_DEVICE = 'Unknown device';

/**
 * Where a console session crews `argo` from: the device it signed in from, as
 * the description of an OTHER location, the one kind that carries words.
 */
export function consoleLocation(device: string): Location {
  return { kind: 'OTHER', description: device };
}

/** When an operator's session used at `usedAt` expires: it is valid strictly before that moment. */
export function consoleSessionExpiry(usedAt: Date): Date {
  return new Date(usedAt.getTime() + CONSOLE_SESSION_IDLE_LIMIT_MS);
}

/** A viewer session started at `at`: how long it lasts idle, when it ends at the latest, and when it first expires. */
export function viewerSessionTimes(at: Date): { idleLimitMs: number; endsBy: Date; expiresAt: Date } {
  return {
    idleLimitMs: VIEWER_SESSION_IDLE_LIMIT_MS,
    endsBy: new Date(at.getTime() + VIEWER_SESSION_LIFETIME_MS),
    expiresAt: new Date(at.getTime() + VIEWER_SESSION_IDLE_LIMIT_MS),
  };
}
