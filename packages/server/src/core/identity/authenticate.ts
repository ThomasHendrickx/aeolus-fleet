import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { SecretHasher } from '../shared/secrets.js';
import { consoleSessionExpiry } from './console-session.js';
import type { CallerLookup } from './ports.js';

export interface Authenticate {
  /** The ship holding this valid secret, or undefined. */
  bySecret(secret: string): Promise<Caller | undefined>;
  /**
   * The caller of this live console session, or undefined. Each use keeps the
   * session valid for another 30 days.
   */
  byConsoleSession(token: string): Promise<Caller | undefined>;
}

/** Use case: turns a bearer secret or a console session token into the caller. */
export function createAuthenticate(deps: { callers: CallerLookup; hasher: SecretHasher; clock: Clock }): Authenticate {
  return {
    bySecret: (secret) => deps.callers.bySecretHash(deps.hasher.hash(secret)),
    byConsoleSession: (token) => {
      const now = deps.clock.now();
      return deps.callers.useConsoleSession(deps.hasher.hash(token), now, consoleSessionExpiry(now));
    },
  };
}
