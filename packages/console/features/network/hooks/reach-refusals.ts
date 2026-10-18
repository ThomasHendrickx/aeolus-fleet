'use client';

import { useQuery } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';

/**
 * The reach refusals as argo reads them on Network (design point 7 on #260;
 * decision 0034): the sends the rules refused, newest first, each said as
 * who tried to message whom and what refused it.
 */

/** The fleet's latest reach refusals, newest first: asked only while Network shows. */
export function useReachRefusals(isShown: boolean) {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.reachRefusals.queryOptions(undefined, { enabled: isShown }));
}
