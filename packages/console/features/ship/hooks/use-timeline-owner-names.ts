'use client';

import type { TimelineEntry } from '@aeolus-fleet/common';

import { useListedShipNames } from '../../../lib/listed-ships';
import { retirementOwnerId } from '../services/retirement-owner-id';

/** Names only the new owners referenced by loaded timeline rows, in cached batches refreshed every 30 seconds. */
export function useTimelineOwnerNames(entries: readonly TimelineEntry[]) {
  const ids = entries.flatMap((entry) => {
    const id = retirementOwnerId(entry);
    return id === undefined ? [] : [id];
  });
  return useListedShipNames(ids);
}
