/** What the console's renewal route answered (app/sign-in/renew/route.ts); unreachable when it did not answer. */
export type RenewalOutcome = 'renewed' | 'ended' | 'noRights' | 'unreachable';

const OUTCOMES: readonly RenewalOutcome[] = ['renewed', 'ended', 'noRights', 'unreachable'];

/** Asks the console's server for a fresh account token: it sets the new token cookie itself. */
export async function renew(): Promise<RenewalOutcome> {
  try {
    const answer = await fetch('/sign-in/renew', { method: 'POST', cache: 'no-store' });
    const body: unknown = await answer.json();
    const outcome = typeof body === 'object' && body !== null && 'outcome' in body ? body.outcome : undefined;
    return OUTCOMES.find((known) => known === outcome) ?? 'unreachable';
  } catch {
    return 'unreachable';
  }
}
