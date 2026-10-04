import { refuseEndedLease, type LeaseEnded } from '../registry/public.js';
import type { Caller, Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { SecretHasher } from '../shared/secrets.js';
import type { ConsoleSessionEndReason } from './console-session.js';
import type { CallerLookup } from './ports.js';

export interface ConsoleSessionUse {
  /** argo, crewed under the lease the session holds, or the viewer ship, holding none. */
  caller: Caller | Crew;
  /** The session's new expiry: its idle limit after this use, never past the moment it ends by. */
  expiresAt: Date;
}

/**
 * Why a crew token makes no caller: it never crewed a ship, or its lease has
 * ended, so its session learns that the ship was released rather than that its
 * token is wrong.
 */
export type CrewTokenRefusal = DomainError<'UNKNOWN_CREW_TOKEN'> | LeaseEnded;

export interface Authenticate {
  /**
   * The crew this token belongs to, while its lease is open: the ship and the
   * lease. The ship secret is no crew token: it works only for `register`
   * (ADR 0015).
   */
  byCrewToken(crewToken: string): Promise<Result<Crew, CrewTokenRefusal>>;
  /**
   * The caller of this live console session, or undefined. Each use keeps the
   * session valid for another 30 days, or a viewer's for another 2 hours and
   * never past 24 hours after it started.
   */
  byConsoleSession(token: string): Promise<ConsoleSessionUse | undefined>;
  /**
   * Why the console session of this token ended, so the console can say so:
   * "You signed in somewhere else" is no failure. Undefined while it has not
   * ended, once it has merely expired, or for a token no session has.
   */
  endOfConsoleSession(token: string): Promise<ConsoleSessionEndReason | undefined>;
}

/** Use case: turns a crew token or a console session token into the caller. */
export function createAuthenticate(deps: { callers: CallerLookup; hasher: SecretHasher; clock: Clock }): Authenticate {
  return {
    byCrewToken: async (crewToken) => {
      const lease = await deps.callers.byCrewTokenHash(deps.hasher.hash(crewToken), { at: deps.clock.now() });
      if (!lease) {
        return refuse('UNKNOWN_CREW_TOKEN', 'Call with the crew token register gave you');
      }
      return lease.isOpen ? ok(lease.crew) : refuseEndedLease();
    },
    byConsoleSession: (token) => deps.callers.useConsoleSession({ tokenHash: deps.hasher.hash(token), now: deps.clock.now() }),
    endOfConsoleSession: (token) => deps.callers.consoleSessionEnding(deps.hasher.hash(token)),
  };
}
