'use client';

import { useQuery } from '@tanstack/react-query';

import { useTRPC } from './trpc';

/**
 * The fleet's limits with what each counts, from fleet.limits: for the notices
 * at a limit (canvas 12.1 to 12.3). Read again every minute, so a reset at
 * 00:00 UTC clears the notice without a reload.
 */
export function useFleetLimits() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.limits.queryOptions(undefined, { refetchInterval: 60_000 }));
}
