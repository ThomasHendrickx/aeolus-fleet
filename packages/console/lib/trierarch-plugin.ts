'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dataOf } from './plugin-answer';
import type { ShownConnection } from './shown-connection';
import {
  checkCrewSettings,
  connectTrierarchPlugin,
  joinMachine,
  listMachines,
  readTrierarchPluginConnection,
  readTrierarchPluginVersion,
} from './trierarch-plugin-actions';
import type { SettingsCheck } from './trierarch-plugin-schemas';

/**
 * The trierarch plugin as the browser reads it (decision 0030): its
 * connection, its machines and Join a machine, each through a server function
 * (lib/trierarch-plugin-actions.ts) that calls the plugin and parses its
 * answer on the web app's server.
 */

const CONNECTION_KEY = ['trierarch-plugin', 'connection'];

/** The trierarch plugin's connection as the browser may know it: `none` without the plugin or while it is off for this fleet. */
export function useTrierarchPluginSettings() {
  return useQuery({
    queryKey: CONNECTION_KEY,
    queryFn: async () => dataOf(await readTrierarchPluginConnection()),
  });
}

/**
 * The trierarch plugin's version, for the Trierarchs header (#332);
 * undefined while it loads, when the plugin does not answer, and on a console
 * without it or with it off, which asks nothing.
 */
export function useTrierarchPluginVersion(): string | undefined {
  const isShown = useHasTrierarchPlugin();
  const query = useQuery({
    queryKey: ['console-version', 'trierarch-plugin'],
    queryFn: async () => (await readTrierarchPluginVersion()) ?? null,
    enabled: isShown,
  });
  return query.data ?? undefined;
}

/** Connect the trierarch plugin: the web app's server does the rest; the answer is the new connection. */
export function useConnectTrierarchPlugin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => dataOf(await connectTrierarchPlugin()),
    onSuccess: (connection) => {
      queryClient.setQueryData(CONNECTION_KEY, connection);
    },
  });
}

/**
 * Where the trierarch plugin stands for this console: none without it or
 * while it is off for this fleet; unknown until its connection is read; not
 * connected; connected. A connection that cannot be read counts as not
 * connected.
 */
export type TrierarchPluginConnection = 'unknown' | ShownConnection['state'];

export function useTrierarchPluginConnection(): TrierarchPluginConnection {
  const settings = useTrierarchPluginSettings();
  if (settings.data === undefined) {
    return settings.isError ? 'not-connected' : 'unknown';
  }
  return settings.data.state;
}

/**
 * Whether this console shows the Trierarchs section: the trierarch plugin is
 * set up and on for this fleet. Until it answers, it shows nothing of it.
 */
export function useHasTrierarchPlugin(): boolean {
  const settings = useTrierarchPluginSettings();
  return settings.data !== undefined && settings.data.state !== 'none';
}

const MACHINES_KEY = ['trierarch-plugin', 'machines'];
/** How often the machines are read again: a trierarch reports on its own time. */
const MACHINES_REFRESH_MS = 10_000;

/** The fleet's machines, read again every few seconds; asked only while the trierarch plugin is connected. */
export function useMachines() {
  const isConnected = useTrierarchPluginConnection() === 'connected';
  return useQuery({
    queryKey: MACHINES_KEY,
    queryFn: async () => dataOf(await listMachines()),
    refetchInterval: MACHINES_REFRESH_MS,
    enabled: isConnected,
  });
}

/**
 * Join a machine: the trierarch plugin commissions its trierarch's ship. The
 * answer holds its starting prompt and setup line: shown once, kept only in
 * this browser's memory while the dialog is open.
 */
export function useJoinMachine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => dataOf(await joinMachine(name)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: MACHINES_KEY });
    },
  });
}

const checkKey = (settings: unknown) => ['trierarch-plugin', 'check', JSON.stringify(settings)];

/**
 * Whether the trierarch plugin would place these settings now
 * (`requests.check`), asked again as the form changes; nothing is asked
 * until the form makes settings. `checkNow` asks afresh, for the moment of
 * requesting.
 */
export function useCrewSettingsCheck(settings: unknown) {
  const queryClient = useQueryClient();
  const check = async (): Promise<SettingsCheck> => dataOf(await checkCrewSettings(settings));
  const query = useQuery({
    queryKey: checkKey(settings),
    queryFn: check,
    enabled: settings !== undefined,
  });
  const checkNow = (): Promise<SettingsCheck> => queryClient.query({ queryKey: checkKey(settings), queryFn: check, staleTime: 0 });
  return { ...query, checkNow };
}
