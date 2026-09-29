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
  /** The agent ship holding this valid secret, or undefined. Never `argo`: it has no secret (ADR 0012). */
  bySecret(secret: string): Promise<Caller | undefined>;
  /**
   * The caller of this live console session, or undefined. Each use keeps the
   * session valid for another 30 days.
   */
  byConsoleSession(token: string): Promise<ConsoleSessionUse | undefined>;
}

/** Use case: turns a bearer secret or a console session token into the caller. */
export function createAuthenticate(deps: { callers: CallerLookup; hasher: SecretHasher; clock: Clock }): Authenticate {
  return {
    bySecret: async (secret) => {
      const ship = await deps.callers.bySecretHash(deps.hasher.hash(secret));
      return ship?.kind === 'agent' ? ship : undefined;
    },
    byConsoleSession: async (token) => {
      const now = deps.clock.now();
      const expiresAt = consoleSessionExpiry(now);
      const caller = await deps.callers.useConsoleSession({ tokenHash: deps.hasher.hash(token), now, expiresAt });
      return caller ? { caller, expiresAt } : undefined;
    },
  };
}
