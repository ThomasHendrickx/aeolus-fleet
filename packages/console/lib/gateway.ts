'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useConsoleRead } from './console-read-query';
import { fetchConsoleRead } from './fetch-console-read';
import { connectGateway } from './gateway-actions';
import { GATEWAY_NO_ANSWER } from './no-answer';
import { dataFrom } from './plugin-answer';

/**
 * The gateway as the browser reads it: its connection, a console read
 * (lib/console-reads.ts), and connecting it, a server function
 * (lib/gateway-actions.ts); either calls the gateway and parses its answer on
 * the web app's server. The gateway serves its own pages (decision 0043).
 */

const CONNECTION_KEY = ['gateway', 'connection'];

/** The gateway's connection as the browser may know it: `none` without the gateway or while it is off for this fleet. */
export function useGatewaySettings() {
  return useConsoleRead({
    queryKey: CONNECTION_KEY,
    queryFn: () => fetchConsoleRead({ read: 'gateway-connection' }),
  });
}

/** Whether the gateway is set up and on for this fleet. Until it answers, nothing of it shows. */
export function useHasGateway(): boolean {
  const settings = useGatewaySettings();
  return settings.data !== undefined && settings.data.state !== 'none';
}

/** Connect the gateway: the web app's server does the rest; the answer is the new connection. */
export function useConnectGateway() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => dataFrom(connectGateway, GATEWAY_NO_ANSWER),
    onSuccess: (connection) => {
      queryClient.setQueryData(CONNECTION_KEY, connection);
    },
  });
}
