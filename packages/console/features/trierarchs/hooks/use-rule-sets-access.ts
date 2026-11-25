'use client';

import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../../lib/trpc';

/** Rule sets are visible to fleet readers, and the guard scope alone permits changes. */
export function useRuleSetsAccess() {
  const trpc = useTRPC();
  const session = useQuery(trpc.console.session.queryOptions()).data;
  return {
    fleetId: session?.fleetId,
    canReadRuleSets: session?.scopes.includes('fleet:read') === true,
    canChangeRuleSets: session?.scopes.includes('trierarch:guard') === true,
  };
}
