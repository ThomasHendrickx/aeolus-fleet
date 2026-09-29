'use client';

import type { AppRouter } from '@aeolus-fleet/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { useState, type ReactNode } from 'react';

import { trpcErrorCode } from '../lib/errors';
import { TRPCProvider } from '../lib/trpc';

/** Retrying cannot fix a missing session or a missing scope. */
function retry(failureCount: number, error: unknown): boolean {
  const code = trpcErrorCode(error);
  return code !== 'UNAUTHORIZED' && code !== 'FORBIDDEN' && failureCount < 3;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry } } }));
  const [trpcClient] = useState(() => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] }));

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
