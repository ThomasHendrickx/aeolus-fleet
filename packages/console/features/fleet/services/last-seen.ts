const MINUTE_MS = 60_000;
/** Up to this long ago a ship was seen a while ago; after it, long ago (docs/design/png/LastSeen.png). */
const A_WHILE_MS = 15 * MINUTE_MS;

/** How recently a ship's session was heard from: under 1 minute, up to 15 minutes, or longer. */
export type SeenSignal = 'fresh' | 'while' | 'long';

/** The signal LastSeen shows: the same thresholds for every ship, squadron members included. */
export function seenSignal(seenAt: Date, now: Date): SeenSignal {
  const elapsedMs = now.getTime() - seenAt.getTime();
  if (elapsedMs < MINUTE_MS) {
    return 'fresh';
  }
  return elapsedMs <= A_WHILE_MS ? 'while' : 'long';
}
