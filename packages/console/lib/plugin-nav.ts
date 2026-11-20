'use client';

import { useAccess } from './access';
import { useHasGateway } from './gateway';
import { useHasOwnSignIn } from './own-sign-in';
import { needsCrewCountOf, useShipCounts } from './ship-counts';
import { useHasSquadrons } from './squadrons';
import { silentCount } from './machines';
import { useHasTrierarchPlugin, useMachines } from './trierarch-plugin';
import { useHasWatchPlugin } from './watch-plugin';

/**
 * What the navigation shows of crew requests and the plugins: the Needs crew
 * count; Squadrons and Trierarchs when each is on for this fleet, Trierarchs'
 * count of silent machines (requests no trierarch can take show on Needs
 * crew, not here); Network for a session holding fleet:network; and Settings, which holds the plugins, the gateway, the watch plugin and
 * argo's own sign-in, for a session that manages the fleet.
 */
export function usePluginNav(): { needsCrewCount?: number; hasSquadrons: boolean; hasTrierarchs: boolean; trierarchsCount?: number; hasNetwork: boolean; hasInstallationSettings: boolean } {
  const access = useAccess();
  const hasSquadrons = useHasSquadrons();
  const hasTrierarchs = useHasTrierarchPlugin();
  const hasGateway = useHasGateway();
  const hasWatchPlugin = useHasWatchPlugin();
  const hasOwnSignIn = useHasOwnSignIn();
  const machines = useMachines();
  const counts = useShipCounts();
  return {
    ...(counts.data === undefined ? {} : { needsCrewCount: needsCrewCountOf(counts.data, { hasTrierarchs }) }),
    hasSquadrons,
    hasTrierarchs,
    ...(machines.data === undefined ? {} : { trierarchsCount: silentCount(machines.data) }),
    hasNetwork: access.canEditNetwork,
    hasInstallationSettings: access.canManage && (hasSquadrons || hasTrierarchs || hasGateway || hasWatchPlugin || hasOwnSignIn),
  };
}
