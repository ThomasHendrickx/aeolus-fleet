'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';

/**
 * The fleet's own network rules as a fleet:network session reads, drafts and
 * applies them on Network (decision 0034): the applied rules and the draft,
 * from the fleet. Saving keeps the draft; only applying puts it in force.
 */

/** The applied rules at their settings version, and the draft beside them: asked only while Network shows. */
export function useNetworkRules(isShown: boolean) {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.networkRules.queryOptions(undefined, { enabled: isShown }));
}

/** Saves the editor's rules whole as the fleet's draft, or none for all-to-all, then reads the rules again. */
export function useSaveNetworkRulesDraft() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    trpc.fleet.saveNetworkRulesDraft.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.fleet.networkRules.queryKey() }),
    }),
  );
}

/** Applies the draft against the settings version the page shows, then reads what the rules change again. */
export function useApplyNetworkRules() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    trpc.fleet.applyNetworkRules.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.fleet.networkRules.queryKey() }),
          // Open follows the applied rules, and the fleet graph the reach they allow.
          queryClient.invalidateQueries({ queryKey: trpc.fleet.builtInRules.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.fleet.explainReach.pathKey() }),
        ]);
      },
    }),
  );
}
