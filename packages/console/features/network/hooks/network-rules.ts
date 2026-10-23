'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useTRPC, useTRPCClient } from '../../../lib/trpc';
import { exportFileNameOf } from '../services/rules-file';

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

/** Hands the browser a file to save, as a download. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Exports the applied rules and downloads them as one file (design network-io, section 4); answers the file's name. */
export function useExportNetworkRules() {
  const client = useTRPCClient();
  return useMutation({
    mutationFn: async () => {
      const file = await client.fleet.exportNetworkRules.query();
      const name = exportFileNameOf(file);
      download(name, `${JSON.stringify(file, null, 2)}\n`);
      return name;
    },
  });
}

/** Has the fleet check a network rules file, as attached or pasted: it reads nothing in the browser. */
export function useCheckNetworkRulesFile() {
  const trpc = useTRPC();
  return useMutation(trpc.fleet.checkNetworkRulesFile.mutationOptions());
}

/** Imports a checked file into the draft, then reads the rules, the draft changes and the labels again. */
export function useImportNetworkRules() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const readAgain = useReadRulesAgain();
  return useMutation(
    trpc.fleet.importNetworkRules.mutationOptions({
      onSuccess: async () => {
        await Promise.all([readAgain(), queryClient.invalidateQueries({ queryKey: trpc.fleet.labels.queryKey() })]);
      },
    }),
  );
}
