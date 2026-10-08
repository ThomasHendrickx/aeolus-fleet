import type { ShipId } from '@aeolus-fleet/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useTRPC } from './trpc';

/** A kept worktree as a clear request names it (decision 0032): its trierarch, the ship it belonged to and its repository. */
export interface KeptWorktreeName {
  trierarchShipId: ShipId;
  shipId: ShipId;
  repository: string;
}

/** How often the pending clear requests are read again: a trierarch confirms on its own pass. */
const CLEAR_REQUESTS_REFRESH_MS = 10_000;

/** Whether a clear request for the kept worktree waits for its trierarch: the console shows it Clearing. */
export function isClearing(pending: readonly KeptWorktreeName[], worktree: KeptWorktreeName): boolean {
  return pending.some((each) => each.trierarchShipId === worktree.trierarchShipId && each.shipId === worktree.shipId && each.repository === worktree.repository);
}

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
