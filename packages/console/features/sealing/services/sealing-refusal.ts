/**
 * Why turning sealing on or changing a key was refused, as the sealing page
 * says it (sealing page mockup): the key's policy names no fleet; the KMS
 * refused the key, with its reason; changing the company key found the
 * current one not reachable; or another refusal, by the server's message.
 */
export type SealingRefusal = { kind: 'keyNotBoundToFleet' } | { kind: 'keyUnavailable'; reason: string } | { kind: 'currentKeyUnavailable' } | { kind: 'other'; message: string };

/** The reason core gives after "not reachable: ", up to the end of its sentence. */
const REASON = /not reachable: ([^.]+)/;
/** What core adds when the old company key is the one it could not use (B13c). */
const OLD_KEY = 'old company key must be reachable';

export function sealingRefusalOf(refused: { refusal: string | undefined; message: string }): SealingRefusal {
  const { refusal, message } = refused;
  if (refusal === 'KEY_NOT_BOUND_TO_FLEET') {
    return { kind: 'keyNotBoundToFleet' };
  }
  if (refusal === 'KEY_UNAVAILABLE') {
    if (message.includes(OLD_KEY)) {
      return { kind: 'currentKeyUnavailable' };
    }
    const reason = REASON.exec(message)?.[1];
    return reason === undefined ? { kind: 'other', message } : { kind: 'keyUnavailable', reason };
  }
  return { kind: 'other', message };
}
