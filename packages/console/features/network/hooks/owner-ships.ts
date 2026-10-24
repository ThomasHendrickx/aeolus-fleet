'use client';

import type { ListedShip } from '@aeolus-fleet/common';
import { isInReadReach, PAGE_SIZE_MAX } from '@aeolus-fleet/common/rules';
import { useQuery } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';

/**
 * The ships an owner term may name (decision 0045): argo and every active
 * person ship, one `fleet.list` read by their kind, never the whole fleet
 * (decision 4 of the performance design). One per person, so one page holds
 * them. Undefined until read.
 */
export function useOwnerShips(isEnabled: boolean): readonly ListedShip[] | undefined {
  const trpc = useTRPC();
  const read = useQuery(trpc.fleet.list.queryOptions({ shipKind: ['operator', 'person'], limit: PAGE_SIZE_MAX }, { enabled: isEnabled }));
  return read.data?.items.filter(isInReadReach);
}
