'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showToast } from '@aeolus-fleet/ui';
import { readMcpConfiguration, replaceMcpConfiguration } from './mcp-configuration-client';
import { replacementFor, type McpChange, type McpConfiguration } from '../services/mcp-configuration';
import type { McpSaveError } from '../services/mcp-configuration';

const KEY = ['trierarch-plugin', 'mcp-configuration'];

/** Metadata is cached until a save or explicit refresh. Values never enter a query or mutation cache. */
export function useMcpConfiguration(isEnabled: boolean, fetchImplementation: typeof fetch = fetch) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: () => readMcpConfiguration(fetchImplementation),
    enabled: isEnabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const [isPending, setIsPending] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<McpSaveError>();
  const readAgain = async () => {
    setIsReading(true);
    const result = await query.refetch();
    setIsReading(false);
    if (result.isError || result.data === undefined) {
      setError({ kind: 'read-failed', message: 'The trierarch plugin did not answer' });
      return undefined;
    }
    setError(undefined);
    return result.data;
  };
  const save = async (change: McpChange): Promise<boolean> => {
    if (query.data === undefined || isPending || isReading || error?.kind === 'no-answer' || error?.kind === 'read-failed') return false;
    setIsPending(true);
    setError(undefined);
    const replacement = replacementFor(query.data, change);
    const result = await replaceMcpConfiguration(replacement, fetchImplementation);
    if (result.kind === 'saved') {
      const metadata: McpConfiguration = { version: result.version, servers: replacement.servers, secrets: replacement.secrets };
      queryClient.setQueryData(KEY, metadata);
      void queryClient.invalidateQueries({ queryKey: KEY });
      setError(undefined);
      setIsPending(false);
      showToast({ title: `Saved as version ${result.version}`, description: 'Machines apply it on their next pass.' });
      return true;
    }
    if (result.kind === 'stale') {
      const current = await readAgain();
      if (current !== undefined) setError({ kind: 'stale', version: current.version });
    } else {
      setError(result);
    }
    setIsPending(false);
    return false;
  };
  return {
    query,
    save,
    error,
    isPending,
    isReading,
    readAgain,
    reset: () => {
      setError(undefined);
    },
  };
}
