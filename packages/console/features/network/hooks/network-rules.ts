'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';

/**
 * The fleet's own network rules as a fleet:network session reads, drafts and
 * applies them on Network (decision 0035): the applied rules and the draft,
 * what the draft changes, from the fleet. Saving keeps the draft; only
 * applying puts it in force.
 */

/** The applied rules at their settings version, and the draft beside them: asked only while Network shows. */
export function useNetworkRules(isShown: boolean) {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.networkRules.queryOptions(undefined, { enabled: isShown }));
}

/** What the draft gains and loses per verb: asked only while the fleet has a draft. */
export function useNetworkRulesDraftChanges(hasDraft: boolean) {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.networkRulesDraftChanges.queryOptions(undefined, { enabled: hasDraft }));
}

/** Reads the rules, what the draft changes and the reach again after a change of the draft or the rules. */
function useReadRulesAgain() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.fleet.networkRules.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.fleet.networkRulesDraftChanges.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.fleet.explainReach.pathKey() }),
    ]);
  };
}

/** Saves the editor's rules whole as the fleet's draft, or none for all-to-all. */
export function useSaveNetworkRulesDraft() {
  const trpc = useTRPC();
  const readAgain = useReadRulesAgain();
  return useMutation(trpc.fleet.saveNetworkRulesDraft.mutationOptions({ onSuccess: readAgain }));
}

/** Drops the draft; the applied rules stay as they are. */
export function useDiscardNetworkRulesDraft() {
  const trpc = useTRPC();
  const readAgain = useReadRulesAgain();
  return useMutation(trpc.fleet.discardNetworkRulesDraft.mutationOptions({ onSuccess: readAgain }));
}

/** Applies the draft against the settings version the page shows. */
export function useApplyNetworkRules() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const readAgain = useReadRulesAgain();
  return useMutation(
    trpc.fleet.applyNetworkRules.mutationOptions({
      onSuccess: async () => {
        // Open follows the applied rules.
        await Promise.all([readAgain(), queryClient.invalidateQueries({ queryKey: trpc.fleet.builtInRules.queryKey() })]);
      },
    }),
  );
}
