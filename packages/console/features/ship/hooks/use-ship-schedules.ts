'use client';

import { SCHEDULE_STATES, type ShipId } from '@aeolus-fleet/common';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { CONSOLE_PAGE_SIZE, nextCursorOf, pagedListOf } from '../../../lib/paged-list';
import { useTRPC } from '../../../lib/trpc';

/**
 * A ship's schedules, newest first, in every state, so an ended or cancelled
 * one still shows what it last did (`fleet.schedules`, fleet:manage).
 */
export function useShipSchedules(shipId: ShipId) {
  const trpc = useTRPC();
  return pagedListOf(
    useInfiniteQuery(
      trpc.fleet.schedules.infiniteQueryOptions(
        { shipId, limit: CONSOLE_PAGE_SIZE, states: [...SCHEDULE_STATES] },
        { getNextPageParam: nextCursorOf },
      ),
    ),
  );
}

/** Refreshes the schedules and the timeline, which shows the pause or cancel as an event. */
function useRefreshSchedules() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([queryClient.invalidateQueries(trpc.fleet.schedules.pathFilter()), queryClient.invalidateQueries(trpc.fleet.shipTimeline.pathFilter())]);
  };
}

/** argo pauses a ship's schedule: it sends nothing until its ship resumes it (decision 0062, S10). */
export function usePauseSchedule() {
  const trpc = useTRPC();
  const refresh = useRefreshSchedules();
  return useMutation(trpc.fleet.pauseSchedule.mutationOptions({ onSuccess: refresh }));
}

/** argo cancels a ship's schedule: it sends nothing more (decision 0062, S10). */
export function useCancelSchedule() {
  const trpc = useTRPC();
  const refresh = useRefreshSchedules();
  return useMutation(trpc.fleet.cancelSchedule.mutationOptions({ onSuccess: refresh }));
}
