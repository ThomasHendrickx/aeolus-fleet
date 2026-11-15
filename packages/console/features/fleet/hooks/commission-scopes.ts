'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useFleetScopes } from '../../../lib/fleet';
import { useTRPC } from '../../../lib/trpc';
import { grantableScopes } from '../services/grantable-scopes';

/** Every individually grantable scope, including meetings, rather than the old fleet access subset. */
export function useCommissionScopes() {
  const trpc = useTRPC();
  const [isRetrying, setIsRetrying] = useState(false);
  const session = useQuery(trpc.console.session.queryOptions());
  const catalogue = useFleetScopes();
  const failure = catalogue.error ?? session.error;
  return {
    scopeGroups: catalogue.data === undefined || session.data === undefined ? undefined : grantableScopes(catalogue.data, session.data.kind === 'operator' ? undefined : session.data.scopes),
    scopeFailure: failure === null && !isRetrying ? undefined : {
      message: failure === null ? 'Reading permissions again. Nothing you typed is lost.' : `${failure.message} Nothing you typed is lost. Try again.`,
      isRetrying,
      onRetry: () => {
        setIsRetrying(true);
        void Promise.all([catalogue.refetch(), session.refetch()]).finally(() => { setIsRetrying(false); });
      },
    },
  };
}
