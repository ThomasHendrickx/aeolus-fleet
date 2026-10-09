'use client';

import type { CrewSettings } from '@aeolus-fleet/common';
import { useQuery } from '@tanstack/react-query';

import { parseCrewSettings } from './crew-settings-actions';

/**
 * Crew requests' settings as crew settings, parsed on the web app's server
 * (lib/crew-settings-actions.ts), in the order given: null for settings that
 * are none. Undefined while the server answers.
 */
export function useCrewSettings(settings: readonly unknown[]): readonly (CrewSettings | null)[] | undefined {
  const query = useQuery({
    queryKey: ['crew-settings', JSON.stringify(settings)],
    queryFn: () => parseCrewSettings(settings),
    enabled: settings.length > 0,
    staleTime: Infinity,
  });
  return settings.length === 0 ? [] : query.data;
}
