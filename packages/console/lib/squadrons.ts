'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dataOf } from './plugin-answer';
import type { ShownConnection } from './shown-connection';
import { connectSquadrons, readSquadronsConnection } from './squadrons-actions';

const QUERY_KEY = ['squadrons', 'connection'];

/**
 * squadrons' connection as the browser may know it, read by the web app's
 * server: `none` without squadrons or while it is off for this fleet.
 */
export function useSquadronsSettings() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => dataOf(await readSquadronsConnection()),
  });
}

/** Connect squadrons: the web app's server does the rest; the answer is the new connection. */
export function useConnectSquadrons() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => dataOf(await connectSquadrons()),
    onSuccess: (connection) => {
      queryClient.setQueryData(QUERY_KEY, connection);
    },
  });
}

/**
 * Whether this console shows squadrons: it has squadrons and squadrons is on
 * for this fleet. Until the web app's server answers, it shows nothing of it,
 * so an operator whose fleet has it off never sees it come and go.
 */
export function useHasSquadrons(): boolean {
  const settings = useSquadronsSettings();
  return settings.data !== undefined && settings.data.state !== 'none';
}

/**
 * Where squadrons stands for this console: none without squadrons or while
 * it is off for this fleet; unknown until its connection is read; not
 * connected; connected. Not connected is a normal state: only a connected
 * squadrons is asked for squadron data. A connection that cannot be read
 * counts as not connected.
 */
export type SquadronsConnection = 'unknown' | ShownConnection['state'];

export function useSquadronsConnection(): SquadronsConnection {
  const settings = useSquadronsSettings();
  if (settings.data === undefined) {
    return settings.isError ? 'not-connected' : 'unknown';
  }
  return settings.data.state;
}
