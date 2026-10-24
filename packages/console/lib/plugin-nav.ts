'use client';

import { useAccess } from './access';
import { useHasGateway } from './gateway';
import { useHasOwnSignIn } from './own-sign-in';
import { needsCrewCountOf, useShipCounts } from './ship-counts';
import { useHasSquadrons } from './squadrons';
import { silentCount } from './machines';
import { useHasTrierarchPlugin, useMachines } from './trierarch-plugin';

/**
 * What the navigation shows of crew requests and the plugins: the Needs crew
 * count; Squadrons and Trierarchs when each is on for this fleet, Trierarchs'
 * count of silent machines (requests no trierarch can take show on Needs
 * crew, not here); Network for a session holding fleet:network; and Settings, which holds the plugins, the gateway and
 * argo's own sign-in, for a session that manages the fleet.
 */
export function usePluginNav(): { needsCrewCount?: number; hasSquadrons: boolean; hasTrierarchs: boolean; trierarchsCount?: number; hasNetwork: boolean; hasSettings: boolean } {
  const access = useAccess();
  const hasSquadrons = useHasSquadrons();
  const hasTrierarchs = useHasTrierarchPlugin();
  const hasGateway = useHasGateway();
  const hasOwnSignIn = useHasOwnSignIn();
  const machines = useMachines();
  const counts = useShipCounts();
  return {
    ...(counts.data === undefined ? {} : { needsCrewCount: needsCrewCountOf(counts.data, { hasTrierarchs }) }),
    hasSquadrons,
    hasTrierarchs,
    ...(machines.data === undefined ? {} : { trierarchsCount: silentCount(machines.data) }),
    hasNetwork: access.canEditNetwork,
    hasSettings: access.canManage && (hasSquadrons || hasTrierarchs || hasGateway || hasOwnSignIn),
  };
}
