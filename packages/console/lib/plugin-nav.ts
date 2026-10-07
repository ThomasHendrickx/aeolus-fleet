'use client';

import { useAccess } from './access';
import { useHasSquadrons } from './squadrons';
import { silentCount } from './machines';
import { useHasTrierarchPlugin, useMachines } from './trierarch-plugin';

/**
 * What the navigation shows of the plugins: Squadrons and Trierarchs when
 * each is on for this fleet, Trierarchs' count of silent machines (requests
 * no trierarch can take show on Needs crew, not here), and Settings, which
 * holds the plugins, for a session that manages the fleet.
 */
export function usePluginNav(): { hasSquadrons: boolean; hasTrierarchs: boolean; trierarchsCount?: number; hasSettings: boolean } {
  const access = useAccess();
  const hasSquadrons = useHasSquadrons();
  const hasTrierarchs = useHasTrierarchPlugin();
  const machines = useMachines();
  return {
    hasSquadrons,
    hasTrierarchs,
    ...(machines.data === undefined ? {} : { trierarchsCount: silentCount(machines.data) }),
    hasSettings: access.canManage && (hasSquadrons || hasTrierarchs),
  };
}
