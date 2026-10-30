/**
 * A payload as a sealed fleet stores it, as the console shows it (decision
 * 0068, N1): plain, sealed and rendered as today with a mark, or sealed while
 * the company key is not reachable, said in its place. A payload stored
 * before sealing that the sealing pass has not sealed yet is plain.
 */
export type PayloadSealing = 'plain' | 'sealed' | 'keyNotReachable';

export function payloadSealingOf(message: { isPayloadSealed: boolean; isPayloadUnreadable: boolean }): PayloadSealing {
  if (message.isPayloadUnreadable) {
    return 'keyNotReachable';
  }
  return message.isPayloadSealed ? 'sealed' : 'plain';
}
