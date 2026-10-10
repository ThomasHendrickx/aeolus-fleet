'use client';

import { useAccess } from './access';
import { useFleetSnapshot } from './fleet';
import { needsCrew } from './needs-crew';
import { useHasNetwork, useHasNetworkingPlugin } from './networking-plugin';
import { useHasSquadrons } from './squadrons';
import { silentCount } from './machines';
import { useHasTrierarchPlugin, useMachines } from './trierarch-plugin';

/**
 * What the navigation shows of crew requests and the plugins: the Needs crew
 * count; Squadrons and Trierarchs when each is on for this fleet, Trierarchs'
 * count of silent machines (requests no trierarch can take show on Needs
 * crew, not here); Network for argo while the networking plugin is
 * connected; and Settings, which holds the plugins, for a session that
 * manages the fleet.
 */
export function usePluginNav(): { needsCrewCount?: number; hasSquadrons: boolean; hasTrierarchs: boolean; trierarchsCount?: number; hasNetwork: boolean; hasSettings: boolean } {
  const access = useAccess();
  const hasSquadrons = useHasSquadrons();
  const hasTrierarchs = useHasTrierarchPlugin();
  const hasNetworkingPlugin = useHasNetworkingPlugin();
  const hasNetwork = useHasNetwork();
  const machines = useMachines();
  const fleet = useFleetSnapshot();
  return {
    ...(fleet.data === undefined ? {} : { needsCrewCount: needsCrew(fleet.data, { hasTrierarchs }).length }),
    hasSquadrons,
    hasTrierarchs,
    ...(machines.data === undefined ? {} : { trierarchsCount: silentCount(machines.data) }),
    hasNetwork,
    hasSettings: access.canManage && (hasSquadrons || hasTrierarchs || hasNetworkingPlugin),
  };
}
