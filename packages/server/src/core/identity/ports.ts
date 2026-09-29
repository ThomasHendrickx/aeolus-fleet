import type { ConsoleSessionId, CredentialId, FleetId, ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { ConsoleSession } from './console-session.js';
import type { Credential } from './credential.js';

/** The ship a secret or a session token belongs to, as the caller it makes. */
export type AuthenticatedShip = Omit<Caller, 'consoleSessionId'>;

/**
 * Outbound port: ship secrets.
 *
 * Lock order, so concurrent sign-ins, sign-outs, starting prompts and secret
 * replacements never deadlock: the ship when the use case locks it, then a
 * credential, then console sessions, then leases.
 */
export interface CredentialRepository {
  create(credential: Credential): Promise<void>;
  /**
   * The valid credential with this hash and the ship it belongs to, locked until
   * the unit of work ends. Not scoped by fleet: a secret carries no fleet, and
   * its hash is unique across all fleets (ADR 0007).
   */
  findValidBySecretHashForUpdate(
    secretHash: string,
  ): Promise<{ credential: Credential; ship: AuthenticatedShip } | undefined>;
  /** The ship's valid credential, locked until the unit of work ends. */
  findValidForShipForUpdate(fleetId: FleetId, shipId: ShipId): Promise<Credential | undefined>;
  markClaimed(change: { fleetId: FleetId; credentialId: CredentialId; at: Date }): Promise<void>;
  invalidate(change: { fleetId: FleetId; credentialId: CredentialId; at: Date }): Promise<void>;
}

/** Outbound port: console sessions, always within one fleet. */
export interface ConsoleSessionRepository {
  create(session: ConsoleSession): Promise<void>;
  /** Ends the session if it has not ended and returns it; undefined when it had already ended. */
  end(change: { fleetId: FleetId; consoleSessionId: ConsoleSessionId; at: Date }): Promise<ConsoleSession | undefined>;
  /** Ends every session of the fleet that has not ended, expired ones included, and returns them. */
  endAll(fleetId: FleetId, at: Date): Promise<ConsoleSession[]>;
}

/**
 * Outbound port: who is calling. Each lookup is one query that returns the
 * ship, its fleet, kind and scopes, and is not scoped by fleet, because a
 * secret or a token carries no fleet (ADR 0007).
 */
export interface CallerLookup {
  /** The ship whose valid secret has this hash. A retired ship has none. */
  bySecretHash(secretHash: string): Promise<AuthenticatedShip | undefined>;
  /**
   * The caller of the console session with this token hash, when the session
   * has not ended and expires after `now`. Using it moves its last use to `now`
   * and its expiry to `expiresAt`.
   */
  useConsoleSession(use: { tokenHash: string; now: Date; expiresAt: Date }): Promise<Caller | undefined>;
}
