'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useConsoleRead } from './console-read-query';
import { fetchConsoleRead } from './fetch-console-read';
import { WATCH_PLUGIN_NO_ANSWER } from './no-answer';
import { dataFrom } from './plugin-answer';
import { connectWatchPlugin } from './watch-plugin-actions';

/**
 * The watch plugin as the browser reads it: its connection, a console read
 * (lib/console-reads.ts), and connecting it, a server function
 * (lib/watch-plugin-actions.ts); either calls the watch plugin and parses its
 * answer on the web app's server.
 */

const CONNECTION_KEY = ['watch-plugin', 'connection'];

/** The watch plugin's connection as the browser may know it: `none` without the watch plugin or while it is off for this fleet. */
export function useWatchPluginSettings() {
  return useConsoleRead({
    queryKey: CONNECTION_KEY,
    queryFn: () => fetchConsoleRead({ read: 'watch-plugin-connection' }),
  });
}

/** Whether the watch plugin is set up and on for this fleet. Until it answers, nothing of it shows. */
export function useHasWatchPlugin(): boolean {
  const settings = useWatchPluginSettings();
  return settings.data !== undefined && settings.data.state !== 'none';
}

/** Connect the watch plugin: the web app's server does the rest; the answer is the new connection. */
export function useConnectWatchPlugin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => dataFrom(connectWatchPlugin, WATCH_PLUGIN_NO_ANSWER),
    onSuccess: (connection) => {
      queryClient.setQueryData(CONNECTION_KEY, connection);
    },
  });
}
