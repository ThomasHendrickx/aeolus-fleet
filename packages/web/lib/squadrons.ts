'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

/** Whether squadrons is set up for this console and connected, as the web app's server reads it. */
export function useSquadronsSettings() {
  return useQuery({ queryKey: QUERY_KEY, queryFn: async () => answered(await fetch(PATH, { cache: 'no-store' })) });
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
  return useSquadronsSettings().data?.configured === true;
}
