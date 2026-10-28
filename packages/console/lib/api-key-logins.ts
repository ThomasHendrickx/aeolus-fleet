import type { TrierarchReportDetails } from '@aeolus-fleet/common';

/**
 * The console's parts for sessions on an API key (aeolus-fleet-trierarch's
 * api keys design, K12), read from a trierarch's report (K8): never a key,
 * only logins, key states and what the ships spent on the key at list prices.
 */

export type SessionLogin = 'subscription' | 'apiKey';

export type KeyState = 'none' | 'ready' | 'refused' | 'outOfCredit';

/** A key that is not ready, and since when where the trierarch knows it. */
export interface KeyNotReady {
  key: Exclude<KeyState, 'ready'>;
  at?: string;
}

/** A harness's login line on the computer card. */
export interface HarnessLogin {
  default: SessionLogin;
  /** How many of its ships run on the login other than its default. */
  otherCount: number;
  /** What its ships spent on the key; none when they spent nothing on it. */
  spentOnKeyUsd?: number;
  /** Its key, while it is not ready and a ship needs it. */
  keyNotReady?: KeyNotReady;
  /** How many of its ships need the key while it is not ready. */
  waitingShips?: number;
}

/** A ship's login on its crew request card. */
export interface ShipLogin {
  login: SessionLogin;
  /** The other login its next start would use (K3). */
  next?: SessionLogin;
  /** What it spent on the key; none when it spent nothing on it. */
  spentOnKeyUsd?: number;
  /** Its harness's key, while it is not ready and the ship needs it. */
  keyNotReady?: KeyNotReady;
}

export const LOGIN_WORDS: Readonly<Record<SessionLogin, string>> = { apiKey: 'API key', subscription: 'Subscription' };

type LoginEntry = NonNullable<TrierarchReportDetails['logins']>[number];

/** The sum of the priced tokens the ships spent on the key; none when it is nothing. */
function spentOnKey(details: TrierarchReportDetails, shipIds: ReadonlySet<string>): number | undefined {
  const spent = (details.usage?.ships ?? [])
    .filter((ship) => shipIds.has(ship.shipId))
    .flatMap((ship) => ship.models)
    .reduce((sum, model) => (model.login === 'apiKey' && model.estimatedCostUsd !== null ? sum + model.estimatedCostUsd : sum), 0);
  // Cents, so a sum of floats reads as the mockup writes it.
  return spent > 0 ? Math.round(spent * 100) / 100 : undefined;
}

function keyNotReadyOf(details: TrierarchReportDetails, harness: string): KeyNotReady | undefined {
  const login = details.harnesses.find((each) => each.harness === harness)?.login;
  if (login === undefined || login.key === 'ready') {
    return undefined;
  }
  return { key: login.key, ...(login.keyStateAt === undefined ? {} : { at: login.keyStateAt }) };
}

/** Whether a ship needs its harness's key: its session runs on it, or its next start would. */
function needsKey(entry: LoginEntry): boolean {
  return entry.login === 'apiKey' || entry.next === 'apiKey';
}

/**
 * A harness's login line (K12): its default, how many of its ships run on the
 * other login, what they spent on the key, and its key while it is not ready
 * and ships wait on it. A ship counts under the harness its crewing session
 * stated; none from a trierarch that reports no login.
 */
export function harnessLoginOf(details: TrierarchReportDetails, at: { harness: string; ships: readonly { id: string; harness: string | null }[] }): HarnessLogin | undefined {
  const login = details.harnesses.find((each) => each.harness === at.harness)?.login;
  if (login === undefined) {
    return undefined;
  }
  const shipIds = new Set(at.ships.filter((ship) => ship.harness === at.harness).map((ship) => ship.id));
  const entries = (details.logins ?? []).filter((entry) => shipIds.has(entry.shipId));
  const spentOnKeyUsd = spentOnKey(details, shipIds);
  const keyNotReady = keyNotReadyOf(details, at.harness);
  const waitingShips = entries.filter(needsKey).length;
  return {
    default: login.default,
    otherCount: entries.filter((entry) => entry.login !== login.default).length,
    ...(spentOnKeyUsd === undefined ? {} : { spentOnKeyUsd }),
    ...(keyNotReady === undefined || waitingShips === 0 ? {} : { keyNotReady, waitingShips }),
  };
}

/**
 * A ship's login (K12): the login of its running or last session, the other
 * one its next start would use, what it spent on the key, and its harness's
 * key while it is not ready and the ship needs it: the session runs on it, or,
 * with no session running, its next start would. None from a trierarch that
 * reports no login for it.
 */
export function shipLoginOf(details: TrierarchReportDetails, at: { shipId: string; harness: string | undefined; isRunning: boolean }): ShipLogin | undefined {
  const entry = details.logins?.find((each) => each.shipId === at.shipId);
  if (entry === undefined) {
    return undefined;
  }
  const spentOnKeyUsd = spentOnKey(details, new Set([at.shipId]));
  const needed = at.isRunning ? entry.login : (entry.next ?? entry.login);
  const keyNotReady = needed === 'apiKey' && at.harness !== undefined ? keyNotReadyOf(details, at.harness) : undefined;
  return {
    login: entry.login,
    ...(entry.next === undefined ? {} : { next: entry.next }),
    ...(spentOnKeyUsd === undefined ? {} : { spentOnKeyUsd }),
    ...(keyNotReady === undefined ? {} : { keyNotReady }),
  };
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$41.20". */
export function usd(amount: number): string {
  return USD.format(amount);
}

/** The chip a key that is not ready shows on the computer card. */
export const KEY_CHIP_WORDS: Readonly<Record<KeyNotReady['key'], string>> = { outOfCredit: 'Out of credit', refused: 'Refused', none: 'No key' };

/** The head of a ship's note while its key is not ready, before since when. */
export const KEY_NOTE_WORDS: Readonly<Record<KeyNotReady['key'], string>> = { outOfCredit: 'API key out of credit', refused: 'API key refused', none: 'No API key' };

/** What the spend on the key means, in its tooltip. */
export const SPEND_TOOLTIP = 'At list prices. The bill is in the Anthropic or OpenAI console.';

/** What `next` means, in its tooltip. */
export const NEXT_TOOLTIP = 'From its next start.';

/**
 * What the chip means, in its tooltip: since when, and how the key gets
 * ready again (K10): an out-of-credit key is checked every 15 minutes, a
 * refused one only with a new key. None for no key.
 */
export function keyTooltip(key: KeyNotReady, sinceWords: string | undefined): string | undefined {
  const since = sinceWords === undefined ? '' : `Since ${sinceWords}. `;
  switch (key.key) {
    case 'outOfCredit':
      return `${since}Checked every 15 min.`;
    case 'refused':
      return `${since}Ready again with a new key.`;
    case 'none':
      return undefined;
  }
}
