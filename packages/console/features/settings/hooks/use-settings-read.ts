'use client';

import { useQuery } from '@tanstack/react-query';

import { useAccess } from '../../../lib/access';
import { useIsAppsListRead } from '../../../lib/app-switcher';
import { useGatewaySettings } from '../../../lib/gateway';
import { useSquadronsSettings } from '../../../lib/squadrons';
import { useTrierarchPluginSettings } from '../../../lib/trierarch-plugin';
import { useTRPC } from '../../../lib/trpc';
import { useWatchPluginSettings } from '../../../lib/watch-plugin';
import { isSettingsRead } from '../services/settings-read';

/** Whether what Settings shows is read (isSettingsRead): until then the page shows its loading shape. */
export function useIsSettingsRead(): boolean {
  const trpc = useTRPC();
  const session = useQuery(trpc.console.session.queryOptions());
  const account = useQuery(trpc.console.account.queryOptions());
  const isAppsListRead = useIsAppsListRead();
  const { canManage } = useAccess();
  const installation = [useSquadronsSettings(), useTrierarchPluginSettings(), useGatewaySettings(), useWatchPluginSettings()];
  return isSettingsRead({
    signedInAs: session.data?.kind,
    isAccountRead: !account.isPending,
    isAppsListRead,
    canManage,
    installationReads: installation.map((read) => !read.isPending),
  });
}
