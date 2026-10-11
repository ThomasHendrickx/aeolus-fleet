'use client';

import type { AppRouter } from '@aeolus-fleet/core';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCClient, createWSClient, httpBatchLink, httpLink, splitLink, wsLink } from '@trpc/client';
import { useState, type ReactNode } from 'react';

import { Toaster } from '../components/atoms/toast';
import { AnalyticsContext, useAnalyticsPageviews } from '../lib/analytics-client';
import { ConsoleConstantsContext, type ConsoleConstants } from '../lib/console-constants';
import { trpcErrorCode } from '../lib/errors';
import { HostedAccountUrlContext } from '../lib/hosted-account';
import { WayOutContext, useWayOutEndsWithPage } from '../lib/session';
import { createSessionFetch } from '../lib/session-fetch';
import { TRPCProvider } from '../lib/trpc';
import { createWayOut, type WayOut } from '../lib/way-out';

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
 * server replays what was missed. Sign out travels alone, so no other call in
 * its batch renews the cookie it clears (lib/session-fetch.ts).
 */
function createClient(serverUrl: string) {
  const sockets = createWSClient({
    url: `${serverUrl.replace(/^http/, 'ws')}/trpc`,
    lazy: { enabled: true, closeMs: 0 },
  });
  const url = `${serverUrl}/trpc`;
  const sessionFetch = createSessionFetch(withCredentials);
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (operation) => operation.type === 'subscription',
        true: wsLink({ client: sockets }),
        false: splitLink({
          condition: (operation) => operation.path === 'console.signOut',
          true: httpLink({ url, fetch: sessionFetch }),
          false: httpBatchLink({ url, fetch: sessionFetch }),
        }),
      }),
    ],
  });
}

/** Ends the way out once the page goes (lib/way-out.ts). */
function WayOutEndsWithPage({ wayOut }: { wayOut: WayOut }): null {
  useWayOutEndsWithPage(wayOut);
  return null;
}

/** Tracks a pageview per page shown, while analytics is on. */
function Pageviews(): null {
  useAnalyticsPageviews();
  return null;
}

/**
 * constants: the values from common the browser shows, read by the root layout on the server (decision 0033).
 * hostedAccountUrl: AEOLUS_HOSTED_ACCOUNT_URL, where a hosted operator's account lists the fleet's limits.
 * isAnalyticsOn: whether AEOLUS_HOSTED_ANALYTICS_* configure an adapter (decision 0025); off, the console sends no analytics.
 */
export function Providers({
  serverUrl,
  constants,
  hostedAccountUrl,
  isAnalyticsOn,
  children,
}: {
  serverUrl: string;
  constants: ConsoleConstants;
  hostedAccountUrl?: string;
  isAnalyticsOn: boolean;
  children: ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry } } }));
  const [trpcClient] = useState(() => createClient(serverUrl));
  const [wayOut] = useState(() =>
    createWayOut({
      setOnline: (isOnline) => {
        onlineManager.setOnline(isOnline);
      },
      forget: () => {
        queryClient.clear();
      },
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ConsoleConstantsContext value={constants}>
          <HostedAccountUrlContext value={hostedAccountUrl}>
            <AnalyticsContext value={isAnalyticsOn}>
              <WayOutContext value={wayOut}>
                <Pageviews />
                <WayOutEndsWithPage wayOut={wayOut} />
                {children}
              </WayOutContext>
              <Toaster />
            </AnalyticsContext>
          </HostedAccountUrlContext>
        </ConsoleConstantsContext>
      </TRPCProvider>
    </QueryClientProvider>
  );
}
