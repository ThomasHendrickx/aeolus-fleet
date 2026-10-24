'use client';

import type { ListedShip, ShipId } from '@aeolus-fleet/common';
import { isInReadReach, PAGE_SIZE_MAX } from '@aeolus-fleet/common/rules';
import { useQuery } from '@tanstack/react-query';

import { everyPage } from '../../../lib/every-page';
import { LAST_SEEN_REFRESH_MS } from '../../../lib/fleet';
import { dataOf } from '../../../lib/plugin-answer';
import { useTRPC, useTRPCClient } from '../../../lib/trpc';

/**
 * The ships whose crew requests are assigned to the trierarchs given, for
 * each machine's spots (decision 4 of the performance design): `fleet.list`
 * selects them, so the page reads as many ships as the machines crew, never
 * the whole fleet. Only the ships the session reads whole (decision 0034);
 * undefined until read, none for no trierarch.
 */
export function useAssignedShips(trierarchShipIds: readonly ShipId[] | undefined): readonly ListedShip[] | undefined {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const assignedTo = [...new Set(trierarchShipIds)].toSorted();
  const read = useQuery({
    queryKey: trpc.fleet.list.queryKey({ assignedTo }),
    queryFn: async () => dataOf(await everyPage(async (cursor: string | undefined) => ({ kind: 'answered', data: await client.fleet.list.query({ assignedTo, cursor, limit: PAGE_SIZE_MAX }) }))),
    enabled: trierarchShipIds !== undefined && assignedTo.length > 0,
    refetchInterval: LAST_SEEN_REFRESH_MS,
    select: (ships) => ships.filter(isInReadReach),
  });
  if (trierarchShipIds !== undefined && assignedTo.length === 0) {
    return [];
  }
  return read.data;
}
