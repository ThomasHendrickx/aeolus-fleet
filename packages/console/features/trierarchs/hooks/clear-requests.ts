import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';

/** How often the pending clear requests are read again: a trierarch confirms on its own pass. */
const CLEAR_REQUESTS_REFRESH_MS = 10_000;

/** Every trierarch's pending clear requests, read again every few seconds. */
export function useClearRequests() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.clearRequests.queryOptions(undefined, { refetchInterval: CLEAR_REQUESTS_REFRESH_MS }));
}

/** Asks a trierarch to clear a worktree it kept; it stays Clearing until the trierarch confirms. A clear request is never withdrawn. */
export function useClearWorktree() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    trpc.fleet.clearWorktree.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.fleet.clearRequests.queryKey() }),
    }),
  );
}
