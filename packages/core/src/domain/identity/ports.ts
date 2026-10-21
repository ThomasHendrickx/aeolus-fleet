import type { AccountId, AccountTokenClaims, ConsoleSessionId, CredentialId, FleetId, LeaseId, OperatorId, ShipId, Theme } from '@aeolus-fleet/common';

import type { ShipCaller, Crew } from '../shared/caller.js';
import type { ConsoleSession, ConsoleSessionEndReason } from './console-session.js';
import type { Credential } from './credential.js';
import type { Guide, GuideProgress } from './guide.js';
import type { ConsoleReader, Notice } from './notice.js';
import type { OperatorAccount } from './operator-account.js';
import type { SignInAs, SignInTicket } from './sign-in-ticket.js';

/** The ship a crew token or a console session token belongs to, as the caller it makes. */
export type AuthenticatedShip = Omit<ShipCaller, 'consoleSessionId'>;

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
  byFleet(fleetId: FleetId): Promise<OperatorAccount | undefined>;
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
  /** Sets the email (normalised) and the password hash together: argo's own sign-in from the console. */
  changeLogin(change: { fleetId: FleetId; operatorId: OperatorId; email: string; passwordHash: string }): Promise<void>;
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
  redeem(tokenHash: string, at: Date): Promise<{ fleetId: FleetId; as: SignInAs; accountId: AccountId | null } | undefined>;
}

/** Outbound port: console sessions, within one fleet but for the account's, which spans the installation. */
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
  /**
   * Ends every session the account signed in to as argo that has not ended, in
   * every fleet of the installation, and returns them: a cut-off belongs to the
   * installation, not to a fleet (decision 0055).
   */
  endAllOfAccount(accountId: AccountId, ending: { at: Date; reason: ConsoleSessionEndReason }): Promise<ConsoleSession[]>;
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
  useConsoleSession(use: { tokenHash: string; now: Date }): Promise<{ caller: ShipCaller | Crew; expiresAt: Date } | undefined>;
  /** Why the console session with this token hash ended; undefined when it has not, or no session has the hash. */
  consoleSessionEnding(tokenHash: string): Promise<ConsoleSessionEndReason | undefined>;
}

/** Outbound port: the installation's notices (decision 0023), kept in its order; they belong to no fleet. */
export interface NoticeRepository {
  read(): Promise<Notice[]>;
  /** Replaces every notice with these, in this order. */
  replace(notices: readonly Notice[]): Promise<void>;
}

/** Outbound port: the notices each console reader dismissed, by notice id; they go with the fleet. */
export interface NoticeDismissals {
  dismissed(of: { fleetId: FleetId; reader: ConsoleReader }): Promise<string[]>;
  /** Records the dismissal; one already recorded stays as it was. */
  dismiss(dismissal: { fleetId: FleetId; reader: ConsoleReader; noticeId: string; at: Date }): Promise<void>;
}

/** Outbound port: the installation's guide (decision 0024), one or none; it belongs to no fleet. */
export interface GuideRepository {
  read(): Promise<Guide | null>;
  /** Replaces the guide with this one; null clears it. */
  replace(guide: Guide | null): Promise<void>;
}

/** Outbound port: where each console reader is in the guide; it goes with the fleet. */
export interface GuideProgressRepository {
  progress(of: { fleetId: FleetId; reader: ConsoleReader }): Promise<GuideProgress | null>;
  /** Records the reader's progress over any it recorded before. */
  record(progress: { fleetId: FleetId; reader: ConsoleReader; at: Date } & GuideProgress): Promise<void>;
}

/**
 * Outbound port: pagasae's signature on an account token (decision 0058).
 * Core trusts one issuer and its published keys.
 */
export interface AccountTokenSignatures {
  /**
   * The token's claims when a key the issuer publishes signed it as an
   * access token naming that issuer; undefined for any other token. Says
   * nothing of its fleet, its end or a cut-off: the use case checks those.
   */
  verify(token: string): Promise<AccountTokenClaims | undefined>;
}

/** An account pagasae cut off (decision 0058): its tokens issued before `cutOffAt` are refused until `forgetAt`. */
export interface AccountCutOff {
  accountId: AccountId;
  cutOffAt: Date;
  forgetAt: Date;
}

/**
 * Outbound port: the accounts pagasae cut off (decision 0058), kept by the
 * installation for every fleet it hosts, each until the longest token it
 * refuses has ended. Not scoped by fleet: an account's tokens go to several
 * fleets, and the cut-off holds in each (ADR 0007, the installation).
 */
export interface AccountCutOffRepository {
  /** Keeps the cut-off; one kept for the account with a later cut-off stays as it was. */
  record(cutOff: AccountCutOff): Promise<void>;
  /** When the account was last cut off, while that cut-off is kept at `at`; undefined otherwise. */
  cutOffAt(accountId: AccountId, at: Date): Promise<Date | undefined>;
  /** Forgets every cut-off kept no longer than `at`. */
  forget(at: Date): Promise<void>;
}

export type AccountCutOffLookup = Pick<AccountCutOffRepository, 'cutOffAt'>;

/** Outbound port: whether this installation hosts a fleet, so a token for any other is refused. */
export interface HostedFleets {
  isHosted(fleetId: FleetId): Promise<boolean>;
}
