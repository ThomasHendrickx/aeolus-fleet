'use client';

import type { AppRouter } from '@aeolus-fleet/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCClient, createWSClient, httpBatchLink, splitLink, wsLink } from '@trpc/client';
import { useState, type ReactNode } from 'react';

import { Toaster } from '../components/atoms/toast';
import { trpcErrorCode } from '../lib/errors';
import { HostedAccountUrlContext } from '../lib/hosted-account';
import { SquadronsConfiguredContext } from '../lib/squadrons';
import { TRPCProvider } from '../lib/trpc';

/** Retrying cannot fix a missing session or a missing scope. */
function retry(failureCount: number, error: unknown): boolean {
  const code = trpcErrorCode(error);
  return code !== 'UNAUTHORIZED' && code !== 'FORBIDDEN' && failureCount < 3;
}

/**
 * The browser calls the server itself, at the address the web app runs with.
 * With credentials, so the session cookie goes along when the server is on
 * another host under the cookie's domain.
 */
function withCredentials(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: 'include' });
}

/**
 * Subscriptions travel over one WebSocket to /trpc, opened only once a page
 * subscribes (lazy), so rendering on the server never opens one. The browser
 * sends the session cookie and the page's origin with the upgrade. A lost
 * connection is retried; tRPC resends the number of the last event, so the
 * server replays what was missed.
 */
function createClient(serverUrl: string) {
  const sockets = createWSClient({
    url: `${serverUrl.replace(/^http/, 'ws')}/trpc`,
    lazy: { enabled: true, closeMs: 0 },
  });
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (operation) => operation.type === 'subscription',
        true: wsLink({ client: sockets }),
        false: httpBatchLink({ url: `${serverUrl}/trpc`, fetch: withCredentials }),
      }),
    ],
  });
}

/**
 * isSquadronsConfigured: whether AEOLUS_SQUADRONS_URL is set, read on the server per request; without it the console makes no squadrons call.
 * hostedAccountUrl: AEOLUS_HOSTED_ACCOUNT_URL, where a hosted operator's account lists the fleet's limits.
 */
export function Providers({
  serverUrl,
  isSquadronsConfigured,
  hostedAccountUrl,
  children,
}: {
  serverUrl: string;
  isSquadronsConfigured: boolean;
  hostedAccountUrl?: string;
  children: ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry } } }));
  const [trpcClient] = useState(() => createClient(serverUrl));

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <SquadronsConfiguredContext value={isSquadronsConfigured}>
          <HostedAccountUrlContext value={hostedAccountUrl}>
            {children}
            <Toaster />
          </HostedAccountUrlContext>
        </SquadronsConfiguredContext>
      </TRPCProvider>
    </QueryClientProvider>
  );
}
