'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';

/** Reads the sealing again once a key changed, so the page shows the change in place. */
function useRefreshSealing() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: trpc.fleet.sealing.queryKey() });
}

/** Turns sealing on under a company key, optionally with a recovery key (decision 0068, B4). */
export function useTurnOnSealing() {
  const trpc = useTRPC();
  const refresh = useRefreshSealing();
  return useMutation(trpc.fleet.turnOnSealing.mutationOptions({ onSuccess: refresh }));
}

/** Moves every data key to a new company key (B13c). */
export function useChangeCompanyKey() {
  const trpc = useTRPC();
  const refresh = useRefreshSealing();
  return useMutation(trpc.fleet.changeCompanyKey.mutationOptions({ onSuccess: refresh }));
}

/** Wraps every data key to a new recovery key, or to the first one on a fleet sealed without (B13d). */
export function useChangeRecoveryKey() {
  const trpc = useTRPC();
  const refresh = useRefreshSealing();
  return useMutation(trpc.fleet.changeRecoveryKey.mutationOptions({ onSuccess: refresh }));
}
