'use client';

import type { ShipDetail } from '@aeolus-fleet/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';

/** Catalogue and mutation for one ship; the fleet rechecks grant authority and manage reach on save. */
export function useShipPermissions(ship: ShipDetail) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const session = useQuery(trpc.console.session.queryOptions());
  const catalogue = useQuery(trpc.fleet.scopes.queryOptions());
  const change = useMutation(trpc.fleet.grantScopes.mutationOptions({ onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.fleet.pathKey() }) }));
  const canChange = session.data?.scopes.includes('scopes:grant') === true && ship.status !== 'retired' && ship.kind !== 'operator' && ship.kind !== 'viewer';
  const described = catalogue.data?.flatMap((namespace) => namespace.scopes);
  const choices = described === undefined ? undefined : [...described, ...ship.scopes.filter((scope) => !described.some((choice) => choice.scope === scope)).map((scope) => ({ scope, description: scope }))].map((choice) => ({
    ...choice,
    isLocked: choice.scope === 'messages:send' || choice.scope === 'messages:receive' || !(session.data?.kind === 'operator' || session.data?.scopes.includes(choice.scope) === true),
  }));
  return { choices, canChange, change, catalogue };
}
