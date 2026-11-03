import type { RenewalOutcome } from './renew-account-token';

/**
 * Renewing the account token until it holds scopes a plugin has just
 * declared (issue 1609): the token a person signed in with was minted before
 * the plugin's namespace existed, and pagasae keeps a fleet's catalogue a
 * minute, so the first fresh token may still lack them. The token is renewed
 * once, and once more after the catalogue's minute when it still lacks them.
 */

/** How long to wait before the second renewal: pagasae's catalogue cache (a minute) and a second. */
export const CATALOGUE_WAIT_MS = 61_000;

export interface RenewUntilHolding {
  wanted: readonly string[];
  retryAfterMs: number;
  renew: () => Promise<RenewalOutcome>;
  /** The scopes the session shows now, read after a renewal. */
  scopesNow: () => Promise<readonly string[]>;
  wait: (ms: number) => Promise<void>;
}

/** `holds` when a fresh token carries every wanted scope, `lacks` when two renewals did not bring them, else what stopped the renewal. */
export async function renewUntilHolding(input: RenewUntilHolding): Promise<'holds' | 'lacks' | Exclude<RenewalOutcome, 'renewed'>> {
  const { wanted, retryAfterMs, renew, scopesNow, wait } = input;
  for (const attempt of [1, 2]) {
    if (attempt === 2) {
      await wait(retryAfterMs);
    }
    const outcome = await renew();
    if (outcome !== 'renewed') {
      return outcome;
    }
    const scopes = await scopesNow();
    if (wanted.every((scope) => scopes.includes(scope))) {
      return 'holds';
    }
  }
  return 'lacks';
}
