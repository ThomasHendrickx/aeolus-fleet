'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';

/** Reads the fleet's scopes again once one of its own changed, so every picker and the page show it. */
function useRefreshScopes() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: trpc.fleet.scopes.queryKey() });
}

/** Defines one of the fleet's own scopes; a reserved, a plugin's or a taken name is refused by name (design gateway-scopes, 4.1). */
export function useDefineScope() {
  const trpc = useTRPC();
  const refresh = useRefreshScopes();
  return useMutation(trpc.fleet.defineScope.mutationOptions({ onSuccess: refresh }));
}

/** Changes the description of one of the fleet's own scopes; a scope is never renamed. */
export function useDescribeScope() {
  const trpc = useTRPC();
  const refresh = useRefreshScopes();
  return useMutation(trpc.fleet.describeScope.mutationOptions({ onSuccess: refresh }));
}

/** Removes one of the fleet's own scopes, refused while a ship holds it, naming how many. */
export function useRemoveScope() {
  const trpc = useTRPC();
  const refresh = useRefreshScopes();
  return useMutation(trpc.fleet.removeScope.mutationOptions({ onSuccess: refresh }));
}
