import type { ConsoleSessionId, FleetId, LeaseId, ShipId } from '@aeolus-fleet/common';

import type { Location } from '../registry/public.js';

/**
 * The operator crewing `argo` through the web console. Only the hash of the
 * session token is stored; the token lives in the browser's cookie.
 */
export interface ConsoleSession {
  id: ConsoleSessionId;
  fleetId: FleetId;
  shipId: ShipId;
  /** The lease on `argo` this session holds. */
  leaseId: LeaseId;
  tokenHash: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
}

/** A console session stays valid this long after its last use. */
export const CONSOLE_SESSION_IDLE_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;

/** Where a console session crews `argo` from. */
export const CONSOLE_LOCATION: Location = { kind: 'OTHER', description: 'web console' };

/** When a session used at `usedAt` expires: it is valid strictly before that moment. */
export function consoleSessionExpiry(usedAt: Date): Date {
  return new Date(usedAt.getTime() + CONSOLE_SESSION_IDLE_LIMIT_MS);
}
