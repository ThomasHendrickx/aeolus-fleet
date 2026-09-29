import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useTRPC } from './trpc';

/** The fleet snapshot: every ship with its status and prompt state. */
export function useFleetSnapshot() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.list.queryOptions());
}

/** Refreshes the fleet snapshot after a change to the fleet. */
function useRefreshFleetSnapshot(): () => Promise<void> {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: trpc.fleet.list.queryKey() });
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
