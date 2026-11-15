'use client';

import type { ShipDetail } from '@aeolus-fleet/common';
import { showToast } from '@aeolus-fleet/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useTRPC } from '../../../lib/trpc';
import { shipPermissionsOf } from '../services/ship-permissions';

/** The editor's authority, reads and save outcome; no query or mutation escapes this port. */
export function useShipPermissions(ship: ShipDetail) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [savedVersion, setSavedVersion] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const session = useQuery(trpc.console.session.queryOptions());
  const catalogue = useQuery(trpc.fleet.scopes.queryOptions());
  const manage = useQuery(trpc.fleet.checkManage.queryOptions({ shipId: ship.id }, { enabled: session.data?.scopes.includes('scopes:grant') === true && ship.status !== 'retired' && ship.kind !== 'operator' && ship.kind !== 'viewer', retry: false }));
  const change = useMutation(trpc.fleet.grantScopes.mutationOptions({ onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: trpc.fleet.pathKey() });
    setSavedVersion((version) => version + 1);
    showToast({ title: `Permissions saved for ${ship.name}`, tone: 'success' });
  } }));
  const view = shipPermissionsOf({ ship, actor: session.data, catalogue: catalogue.data, hasManageReach: manage.isSuccess });
  return {
    ...view,
    savedVersion,
    isPending: change.isPending,
    error: change.error?.message,
    readError: catalogue.error?.message,
    isRetrying,
    onRetry: () => {
      setIsRetrying(true);
      void catalogue.refetch().finally(() => { setIsRetrying(false); });
    },
    onSave: (difference: { grant: string[]; revoke: string[] }) => { change.mutate({ shipId: ship.id, ...difference }); },
  };
}
