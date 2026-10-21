/**
 * When the console renews an account's token (accounts design, A3): a
 * little before it ends, in the browser while a page is open and on the
 * console's server on any page load past that point. While pagasae does not
 * answer, the browser retries, more slowly each time, until the token ends.
 */

/** How long before the token ends the console renews it. */
export const RENEW_BEFORE_MS = 120_000;

const FIRST_RETRY_MS = 5_000;
const LONGEST_RETRY_MS = 60_000;

/** How long until the browser renews a token ending at endsAt: at once when that point has passed. */
export function renewalDelayOf({ endsAt, now }: { endsAt: Date; now: Date }): number {
  return Math.max(0, endsAt.getTime() - RENEW_BEFORE_MS - now.getTime());
}

/** How long the browser waits before asking pagasae again, after `attempt` renewals it did not answer. */
export function retryDelayOf(attempt: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** attempt, LONGEST_RETRY_MS);
}

/** When the token in the token cookie ends, read from it unchecked: core checks it, the console only times the renewal. */
export function tokenEndOf(token: string): Date | undefined {
  const payload = token.split('.')[1];
  if (payload === undefined) {
    return undefined;
  }
  try {
    const claims: unknown = JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/')));
    return typeof claims === 'object' && claims !== null && 'exp' in claims && typeof claims.exp === 'number' ? new Date(claims.exp * 1000) : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a page load renews the token first: it ends within RENEW_BEFORE_MS. */
export function isTimeToRenew(token: string, now: Date): boolean {
  const endsAt = tokenEndOf(token);
  return endsAt !== undefined && renewalDelayOf({ endsAt, now }) === 0;
}
