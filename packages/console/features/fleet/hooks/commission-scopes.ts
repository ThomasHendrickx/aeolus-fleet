'use client';

import { useQuery } from '@tanstack/react-query';

import { useFleetScopes } from '../../../lib/fleet';
import { useTRPC } from '../../../lib/trpc';
import { grantableScopes } from '../services/grantable-scopes';

/** Every individually grantable scope, including meetings, rather than the old fleet access subset. */
export function useCommissionScopes() {
  const trpc = useTRPC();
  const session = useQuery(trpc.console.session.queryOptions());
  const catalogue = useFleetScopes();
  return catalogue.data === undefined || session.data === undefined ? undefined : grantableScopes(catalogue.data, session.data.kind === 'operator' ? undefined : session.data.scopes);
}
