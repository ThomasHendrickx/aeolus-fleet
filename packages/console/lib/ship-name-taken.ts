'use client';

import { isShipHandle } from '@aeolus-fleet/common/rules';
import { useQuery } from '@tanstack/react-query';

import { useTRPC } from './trpc';

/**
 * Whether an active ship has the name as typed, for the name fields' live
 * hint: one `fleet.list` read of the active ship of that exact name, never
 * the whole fleet (decision 4 of the performance design). The server refuses
 * a taken name whatever this says. Undefined while read, or for a name that
 * is no handle.
 */
export function useIsShipNameTaken(name: string): boolean | undefined {
  const trpc = useTRPC();
  const isHandle = isShipHandle(name);
  const read = useQuery(trpc.fleet.list.queryOptions({ name, limit: 1 }, { enabled: isHandle }));
  if (!isHandle || read.data === undefined) {
    return undefined;
  }
  return read.data.items.length > 0;
}
