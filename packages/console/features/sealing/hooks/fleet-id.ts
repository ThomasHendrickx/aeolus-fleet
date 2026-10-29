'use client';

import type { FleetId } from '@aeolus-fleet/common';
import { useQuery } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';

/** This session's fleet, by id: the one a company key's policy condition names (ES4); undefined until the session is known. */
export function useSessionFleetId(): FleetId | undefined {
  const trpc = useTRPC();
  return useQuery(trpc.console.session.queryOptions()).data?.fleetId;
}
