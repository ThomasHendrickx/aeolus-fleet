import type { SealingOutput } from '@aeolus-fleet/common';

import { sinceTime } from '../../../lib/relative-time';
import { keyUnavailableReasonWords } from './sealing-view';

/**
 * The overview's notice while a sealed fleet's company key is not reachable
 * (decision 0068, B11): since when and why, what that stops, and that nothing
 * waiting is lost. None in a fleet without sealing, with the key reachable,
 * or while the sealing is not read: the sealing page shows its own error.
 */
export function keyNotReachableNotice(sealing: SealingOutput | undefined, now: Date): { title: string; description: string } | undefined {
  if (sealing === undefined || sealing.state === 'none' || sealing.keyAvailability.isAvailable) {
    return undefined;
  }
  const { reason, since } = sealing.keyAvailability;
  return {
    title: 'Company key not reachable',
    description: `Since ${sinceTime(new Date(since), now)} your KMS answers: ${keyUnavailableReasonWords(reason)}. Sends and receives in this fleet are refused until it is reachable again. Nothing waiting is lost.`,
  };
}
