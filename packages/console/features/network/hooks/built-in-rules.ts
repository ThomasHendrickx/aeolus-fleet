'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';

/**
 * The built-in rules as argo reads and turns them on Network (decision
 * 0034): every one as the fleet answers it, argo's by fleet:network, and
 * the viewer reading, which argo alone turns on or off.
 */

/** Every built-in rule as it is now: asked only while Network shows. */
export function useBuiltInRules(isShown: boolean) {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.builtInRules.queryOptions(undefined, { enabled: isShown }));
}

/** Turns the viewer reading on or off, as argo, then reads the built-in rules again. */
export function useSetViewerRead() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const mutation = useMutation(
    trpc.fleet.setBuiltInRule.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.fleet.builtInRules.queryKey() }),
    }),
  );
  return {
    setViewerRead: (isOn: boolean) => {
      mutation.mutate({ rule: 'viewerRead', isOn });
    },
    isPending: mutation.isPending,
    error: mutation.error?.message,
  };
}
