'use client';

import { useNow } from '../../../lib/now';
import { useFleetSealing } from '../hooks/sealing';
import { keyNotReachableNotice } from '../services/key-not-reachable';
import { KeyNotReachableNotice } from '../ui/molecules/key-not-reachable-notice';

/**
 * The fleet overview's notice while the company key is not reachable
 * (decision 0068, screen 2). Nothing while the sealing loads or fails to load,
 * in a fleet without sealing, or with the key reachable; live sealing events
 * read it again, so it goes by itself once the key is back.
 */
export function KeyNotReachable() {
  const now = useNow();
  const notice = keyNotReachableNotice(useFleetSealing().data, now);
  return notice === undefined ? null : <KeyNotReachableNotice {...notice} />;
}
