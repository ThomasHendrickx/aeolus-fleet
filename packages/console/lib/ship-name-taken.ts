'use client';

import { isShipHandle } from '@aeolus-fleet/common/rules';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { CONSOLE_PAGE_SIZE } from './paged-list';
import { useTRPC } from './trpc';

/**
 * Whether an active ship has the name as typed, for the name fields' live
 * hint: one `fleet.list` read of the ships whose name holds it, never the
 * whole fleet (decision 4 of the performance design). The server refuses a
 * taken name whatever this says. Undefined while read, or for a name that is
 * no handle.
 */
export function useIsShipNameTaken(name: string): boolean | undefined {
  const trpc = useTRPC();
  const isHandle = isShipHandle(name);
  const read = useQuery(trpc.fleet.list.queryOptions({ query: name, limit: CONSOLE_PAGE_SIZE }, { enabled: isHandle, placeholderData: keepPreviousData }));
  return isHandle ? read.data?.items.some((ship) => ship.name === name) : undefined;
}
