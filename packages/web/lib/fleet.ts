import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useTRPC } from './trpc';

/** The fleet snapshot: every ship with its status and prompt state. */
export function useFleetSnapshot() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.list.queryOptions());
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
  return useMutation(trpc.fleet.commission.mutationOptions({ onSuccess: refresh }));
}

/** Gets a new starting prompt for a ship awaiting crew. Its data holds the prompt, to show once. */
export function useGetStartingPrompt() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.getStartingPrompt.mutationOptions({ onSuccess: refresh }));
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
 * prompt at once. Its data holds the prompt and crew line, to show once.
 */
export function useRecrewShip() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.recrew.mutationOptions({ onSuccess: refresh }));
}
