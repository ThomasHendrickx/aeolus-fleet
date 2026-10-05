import type { ConsoleSessionId, CredentialId, FleetId, LeaseId, OperatorId, ShipId, Theme } from '@aeolus-fleet/common';

import type { Caller, Crew } from '../shared/caller.js';
import type { ConsoleSession, ConsoleSessionEndReason } from './console-session.js';
import type { Credential } from './credential.js';
import type { Guide, GuideProgress } from './guide.js';
import type { Notice } from './notice.js';
import type { OperatorAccount } from './operator-account.js';
import type { SignInAs, SignInTicket } from './sign-in-ticket.js';

/** The ship a crew token or a console session token belongs to, as the caller it makes. */
export type AuthenticatedShip = Omit<Caller, 'consoleSessionId'>;

/** The ship a crew token crews, and the open lease the token belongs to. */
export type AuthenticatedCrew = AuthenticatedShip & { leaseId: LeaseId };

/** The lease a crew token belongs to, as the lookup finds it: open, with the crew it makes the caller, or ended. */
export type CrewTokenLease = { isOpen: true; crew: AuthenticatedCrew } | { isOpen: false };

/**
 * Outbound port: ship secrets.
 *
 * Lock order, so concurrent sign-ins, sign-outs, claims, starting prompts and
 * password resets never deadlock: the ship when the use case locks it, then a
 * credential or the operator account, then console sessions, then leases.
 */
export interface CredentialRepository {
  create(credential: Credential): Promise<void>;
  /**
   * The valid credential with this hash, locked until the unit of work ends.
   * Not scoped by fleet: a secret carries no fleet, and its hash is unique
   * across all fleets (ADR 0007).
   */
  findValidBySecretHashForUpdate(secretHash: string): Promise<Credential | undefined>;
  /** The ship's valid credential, locked until the unit of work ends. */
  findValidForShipForUpdate(fleetId: FleetId, shipId: ShipId): Promise<Credential | undefined>;
  markClaimed(change: { fleetId: FleetId; credentialId: CredentialId; at: Date }): Promise<void>;
  invalidate(change: { fleetId: FleetId; credentialId: CredentialId; at: Date }): Promise<void>;
}

/**
 * Outbound port: finds the operator account by its normalised email outside
 * any unit of work, so checking a password holds no row and no connection.
 * One query, not scoped by fleet: signing in names no fleet (ADR 0007).
 */
export interface OperatorAccountLookup {
  byEmail(email: string): Promise<OperatorAccount | undefined>;
}

/** Outbound port: the operator account. */
export interface OperatorAccountRepository {
  create(account: OperatorAccount): Promise<void>;
  /**
   * Holds the lock on this normalised email until the unit of work ends, so
   * two fleets created at once never both take it.
   */
  lockEmail(email: string): Promise<void>;
  /**
   * The account with this normalised email, locked until the unit of work
   * ends. Not scoped by fleet: signing in names no fleet, and the email is
   * unique across all fleets (ADR 0007).
   */
  findByEmailForUpdate(email: string): Promise<OperatorAccount | undefined>;
  /** The fleet's operator account, locked until the unit of work ends. */
  findForFleetForUpdate(fleetId: FleetId): Promise<OperatorAccount | undefined>;
  changePassword(change: { fleetId: FleetId; operatorId: OperatorId; passwordHash: string }): Promise<void>;
  /** The fleet's operator account, read without a lock. */
  findForFleet(fleetId: FleetId): Promise<OperatorAccount | undefined>;
  setTheme(change: { fleetId: FleetId; operatorId: OperatorId; theme: Theme }): Promise<void>;
}

/** Outbound port: sign-in tickets, found by their hash before the fleet is known (ADR 0007). */
export interface SignInTicketRepository {
  create(ticket: SignInTicket): Promise<void>;
  /**
   * Marks the ticket with this hash used and answers its fleet and whom it
   * signs in as, when it is unused and not expired at `at`; undefined
   * otherwise. At most one redeem of a ticket ever answers, however many run
   * at once.
   */
  redeem(tokenHash: string, at: Date): Promise<{ fleetId: FleetId; as: SignInAs } | undefined>;
}

/** Outbound port: console sessions, always within one fleet. */
export interface ConsoleSessionRepository {
  create(session: ConsoleSession): Promise<void>;
  /** The session, read without a lock. */
  find(fleetId: FleetId, consoleSessionId: ConsoleSessionId): Promise<ConsoleSession | undefined>;
  /** Ends the session if it has not ended and returns it; undefined when it had already ended. */
  end(change: {
    fleetId: FleetId;
    consoleSessionId: ConsoleSessionId;
    at: Date;
    reason: ConsoleSessionEndReason;
  }): Promise<ConsoleSession | undefined>;
  /** Ends every session of the ship that has not ended, expired ones included, and returns them. */
  endAll(of: { fleetId: FleetId; shipId: ShipId }, ending: { at: Date; reason: ConsoleSessionEndReason }): Promise<ConsoleSession[]>;
}

/**
 * Outbound port: who is calling. Each lookup is one query that returns the
 * ship, its fleet, kind and scopes, and is not scoped by fleet, because a
 * token carries no fleet (ADR 0007).
 */
export interface CallerLookup {
  /**
   * The lease that holds this crew token hash, open or ended; undefined when
   * no lease of a ship that is not retired ever held it. An open lease is
   * marked seen `at`: every call by its crew shows the ship alive. Observation
   * only (ADR 0016): nothing acts on it.
   */
  byCrewTokenHash(crewTokenHash: string, seen: { at: Date }): Promise<CrewTokenLease | undefined>;
  /**
   * The caller of the console session with this token hash, when the session
   * has not ended and expires after `now`: argo, crewed under the lease the
   * session holds, or the viewer ship, without a lease. Using it moves its
   * last use to `now` and its expiry to its idle limit after `now`, never
   * past the moment it ends by, and marks argo's lease seen `now`. Answers
   * the new expiry.
   */
  useConsoleSession(use: { tokenHash: string; now: Date }): Promise<{ caller: Caller | Crew; expiresAt: Date } | undefined>;
  /** Why the console session with this token hash ended; undefined when it has not, or no session has the hash. */
  consoleSessionEnding(tokenHash: string): Promise<ConsoleSessionEndReason | undefined>;
}

/** Outbound port: the installation's notices (decision 0023), kept in its order; they belong to no fleet. */
export interface NoticeRepository {
  read(): Promise<Notice[]>;
  /** Replaces every notice with these, in this order. */
  replace(notices: readonly Notice[]): Promise<void>;
}

/** Outbound port: the notices each console session dismissed, by notice id; they go with the session's fleet. */
export interface NoticeDismissals {
  dismissed(of: { fleetId: FleetId; consoleSessionId: ConsoleSessionId }): Promise<string[]>;
  /** Records the dismissal; one already recorded stays as it was. */
  dismiss(dismissal: { fleetId: FleetId; consoleSessionId: ConsoleSessionId; noticeId: string; at: Date }): Promise<void>;
}

/** Outbound port: the installation's guide (decision 0024), one or none; it belongs to no fleet. */
export interface GuideRepository {
  read(): Promise<Guide | null>;
  /** Replaces the guide with this one; null clears it. */
  replace(guide: Guide | null): Promise<void>;
}

/** Outbound port: where each console session is in the guide; it goes with the session's fleet. */
export interface GuideProgressRepository {
  progress(of: { fleetId: FleetId; consoleSessionId: ConsoleSessionId }): Promise<GuideProgress | null>;
  /** Records the session's progress over any it recorded before. */
  record(progress: { fleetId: FleetId; consoleSessionId: ConsoleSessionId; at: Date } & GuideProgress): Promise<void>;
}
