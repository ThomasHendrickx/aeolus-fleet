'use client';

import { useQuery } from '@tanstack/react-query';

import { useTRPC } from './trpc';

/**
 * How often the page reads the sealing again while the sealing pass seals
 * what came before: a batch writes no event, so the progress has nothing
 * else to move it. Once sealed, live events alone move it.
 */
const SEALING_PROGRESS_REFRESH_MS = 5_000;

/** The fleet's sealing (`fleet.sealing`): none, or its state, keys and, while sealing, the sealing pass's progress. */
export function useFleetSealing() {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.fleet.sealing.queryOptions(),
    refetchInterval: (query) => (query.state.data?.state === 'sealing' ? SEALING_PROGRESS_REFRESH_MS : false),
  });
}
