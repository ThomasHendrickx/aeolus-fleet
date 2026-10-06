import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAnalytics } from './analytics-client';
import { useTRPC } from './trpc';

/**
 * How often an open console reads the snapshot again: last seen changes with
 * every call a ship makes, which writes no event, so no live update brings it.
 */
export const LAST_SEEN_REFRESH_MS = 30_000;

/** The fleet snapshot: every ship with its status, prompt state and when it was last seen. */
export function useFleetSnapshot() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.list.queryOptions(undefined, { refetchInterval: LAST_SEEN_REFRESH_MS }));
}

/** Refreshes the fleet snapshot, and every ship page read, after a change to the fleet. */
function useRefreshFleetSnapshot(): () => Promise<void> {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: trpc.fleet.pathKey() });
}

/** Commissions a ship. Its data holds the first starting prompt, to show once. */
export function useCommissionShip() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  const { track } = useAnalytics();
  return useMutation(
    trpc.fleet.commission.mutationOptions({
      onSuccess: async () => {
        track({ name: 'ship_commissioned' });
        await refresh();
      },
    }),
  );
}

/** Gets a new starting prompt for a ship awaiting crew. Its data holds the prompt, to show once. */
export function useGetStartingPrompt() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.getStartingPrompt.mutationOptions({ onSuccess: refresh }));
}

/** Pings a crewed ship as argo. While a ping waits unanswered, the server answers with that one. */
export function usePingShip() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.ping.mutationOptions({ onSuccess: refresh }));
}

/** Releases a crewed ship: the session crewing it loses it, and the ship awaits a new crew. */
export function useReleaseShip() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.release.mutationOptions({ onSuccess: refresh }));
}

/**
 * Retires a ship for good: its lease and secret end, its direct deliveries are
 * abandoned. Its data says how many.
 */
export function useRetireShip() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.retire.mutationOptions({ onSuccess: refresh }));
}

/**
 * Re-crews a crewed ship whose session is gone: a release and a new starting
 * prompt at once. Its data holds the prompt and crew lines, to show once.
 */
export function useRecrewShip() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.recrew.mutationOptions({ onSuccess: refresh }));
}

/** Renames a ship; other ships addressing its old name no longer reach it. */
export function useRenameShip() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.rename.mutationOptions({ onSuccess: refresh }));
}
