import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { SecretHasher } from '../shared/secrets.js';
import { consoleSessionExpiry } from './console-session.js';
import type { CallerLookup } from './ports.js';

export interface ConsoleSessionUse {
  caller: Caller;
  /** The session's new expiry: 30 days after this use. */
  expiresAt: Date;
}

export interface Authenticate {
  /**
   * The ship this crew token crews, while its lease is open, or undefined. The
   * ship secret is no crew token: it works only for `register` (ADR 0015).
   */
  byCrewToken(crewToken: string): Promise<Caller | undefined>;
  /**
   * The caller of this live console session, or undefined. Each use keeps the
   * session valid for another 30 days.
   */
  byConsoleSession(token: string): Promise<ConsoleSessionUse | undefined>;
}

/** Use case: turns a crew token or a console session token into the caller. */
export function createAuthenticate(deps: { callers: CallerLookup; hasher: SecretHasher; clock: Clock }): Authenticate {
  return {
    byCrewToken: (crewToken) => deps.callers.byCrewTokenHash(deps.hasher.hash(crewToken)),
    byConsoleSession: async (token) => {
      const now = deps.clock.now();
      const expiresAt = consoleSessionExpiry(now);
      const caller = await deps.callers.useConsoleSession({ tokenHash: deps.hasher.hash(token), now, expiresAt });
      return caller ? { caller, expiresAt } : undefined;
    },
  };
}
