'use client';

import type { NetworkRule } from '@aeolus-fleet/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAccess } from './access';
import { fetchConsoleRead } from './fetch-console-read';
import { connectNetworkingPlugin, saveNetworkDeclaration, saveNetworkRules } from './networking-plugin-actions';
import type { Network, NetworkDeclaration } from './networking-plugin-schemas';
import { dataOf } from './plugin-answer';
import { useTRPC } from './trpc';

/**
 * The networking plugin as the browser reads it (decision 0036): its
 * connection, and the network argo edits. Reads are console reads
 * (lib/console-reads.ts), changes server functions
 * (lib/networking-plugin-actions.ts); either calls the plugin and parses its
 * answer on the web app's server.
 */

const CONNECTION_KEY = ['networking-plugin', 'connection'];
const NETWORK_KEY = ['networking-plugin', 'network'];

/** The networking plugin's connection as the browser may know it: `none` without the plugin or while it is off for this fleet. */
export function useNetworkingPluginSettings() {
  return useQuery({
    queryKey: CONNECTION_KEY,
    queryFn: () => fetchConsoleRead({ read: 'networking-plugin-connection' }),
  });
}

/** Whether the networking plugin is set up and on for this fleet. Until it answers, nothing of it shows. */
export function useHasNetworkingPlugin(): boolean {
  const settings = useNetworkingPluginSettings();
  return settings.data !== undefined && settings.data.state !== 'none';
}

/** Whether this session sees Network: argo (fleet:network), with the networking plugin on and connected. */
export function useHasNetwork(): boolean {
  const access = useAccess();
  const settings = useNetworkingPluginSettings();
  return access.canEditNetwork && settings.data?.state === 'connected';
}

/** Connect the networking plugin: the web app's server does the rest; the answer is the new connection. */
export function useConnectNetworkingPlugin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => dataOf(await connectNetworkingPlugin()),
    onSuccess: (connection) => {
      queryClient.setQueryData(CONNECTION_KEY, connection);
    },
  });
}

/** The network argo edits: asked only while Network shows. */
export function useNetwork() {
  const hasNetwork = useHasNetwork();
  return useQuery({
    queryKey: NETWORK_KEY,
    queryFn: () => fetchConsoleRead({ read: 'network' }),
    enabled: hasNetwork,
  });
}

/** Save the rules whole, or none for all-to-all; the answer holds what the supply did. */
export function useSaveNetworkRules() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rules: NetworkRule[] | null) => dataOf(await saveNetworkRules(rules)),
    onSuccess: async (saved) => {
      queryClient.setQueryData<Network>(NETWORK_KEY, (network) => (network === undefined ? undefined : { ...network, rules: saved.rules }));
      // The fleet graph asks the fleet again: the reach it shows follows the rules just supplied.
      await queryClient.invalidateQueries({ queryKey: trpc.fleet.explainReach.pathKey() });
    },
  });
}

/** Save what the plugin declares for while it is unavailable. */
export function useSaveNetworkDeclaration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (declaration: NetworkDeclaration) => dataOf(await saveNetworkDeclaration(declaration)),
    onSuccess: (saved) => {
      queryClient.setQueryData<Network>(NETWORK_KEY, (network) => (network === undefined ? undefined : { ...network, declaration: saved.declaration }));
    },
  });
}
