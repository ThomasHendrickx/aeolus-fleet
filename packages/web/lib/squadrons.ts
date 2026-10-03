'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { z } from 'zod';

/** Squadrons' connection as the Settings page shows it: none when the console has no squadrons. */
const settingsSchema = z.union([
  z.object({ configured: z.literal(false) }),
  z.object({
    configured: z.literal(true),
    connection: z.object({
      state: z.enum(['not-connected', 'connected']),
      ship: z.object({ shipId: z.string(), name: z.string() }).nullable(),
      lastShipId: z.string().nullable(),
    }),
  }),
]);

export type SquadronsSettings = z.infer<typeof settingsSchema>;

const QUERY_KEY = ['squadrons', 'connection'];
const PATH = '/squadrons/connection';

async function answered(response: Response): Promise<SquadronsSettings> {
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(z.object({ message: z.string() }).safeParse(body).data?.message ?? 'Try again in a moment');
  }
  return settingsSchema.parse(body);
}

/**
 * Whether this console has squadrons (AEOLUS_SQUADRONS_URL set), as the web
 * app's server read it for this page: known before any call, so a console
 * without squadrons never makes one.
 */
export const SquadronsConfiguredContext = createContext(false);

/** Whether squadrons is set up for this console and connected. Without squadrons it asks nothing: the answer is known. */
export function useSquadronsSettings() {
  const isConfigured = useContext(SquadronsConfiguredContext);
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => answered(await fetch(PATH, { cache: 'no-store' })),
    enabled: isConfigured,
    initialData: isConfigured ? undefined : { configured: false },
  });
}

/** Connect squadrons: the web app's server does the rest; the answer is the new connection. */
export function useConnectSquadrons() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => answered(await fetch(PATH, { method: 'POST' })),
    onSuccess: (settings) => {
      queryClient.setQueryData(QUERY_KEY, settings);
    },
  });
}

/** Whether this console has squadrons: AEOLUS_SQUADRONS_URL is set. The navigation shows Squadrons only then. */
export function useHasSquadrons(): boolean {
  return useContext(SquadronsConfiguredContext);
}

/**
 * Where squadrons stands for this console: none without AEOLUS_SQUADRONS_URL;
 * unknown until its connection is read; not connected; connected. Not
 * configured and not connected are normal states: the console is then a
 * console without squadrons, and only a connected squadrons is asked for
 * squadron data. A connection that cannot be read counts as not connected.
 */
export type SquadronsConnection = 'none' | 'unknown' | 'not-connected' | 'connected';

export function useSquadronsConnection(): SquadronsConnection {
  const settings = useSquadronsSettings();
  if (settings.data === undefined) {
    return settings.isError ? 'not-connected' : 'unknown';
  }
  return settings.data.configured ? settings.data.connection.state : 'none';
}
