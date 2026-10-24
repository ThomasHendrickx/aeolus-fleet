'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { EVERY_SHIP_STATUS } from './every-ship-status';
import { useTRPC } from './trpc';

/** The fleet's ship types (`fleet.shipTypes`), for a Type filter or field: of the active ships, and the retired ones while they are shown. */
export function useShipTypes(isRetiredShown: boolean): readonly string[] | undefined {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.shipTypes.queryOptions(isRetiredShown ? { status: [...EVERY_SHIP_STATUS] } : undefined, { placeholderData: keepPreviousData })).data;
}

/** How many active ships have the type, for a type field's hint (`fleet.shipCounts` with the type); undefined while read or for no type. */
export function useTypeShipCount(type: string): number | undefined {
  const trpc = useTRPC();
  const isType = type !== '';
  const counts = useQuery(trpc.fleet.shipCounts.queryOptions({ filter: { type: [type] } }, { enabled: isType }));
  return isType ? counts.data?.reduce((total, kind) => total + kind.active, 0) : undefined;
}
