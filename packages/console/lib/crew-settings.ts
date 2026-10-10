'use client';

import type { CrewSettings } from '@aeolus-fleet/common';
import { useConsoleRead } from './console-read-query';
import { fetchConsoleRead } from './fetch-console-read';

/**
 * Crew requests' settings as crew settings, parsed on the web app's server
 * (lib/crew-settings-read.ts), in the order given: null for settings that
 * are none. Undefined while the server answers.
 */
export function useCrewSettings(settings: readonly unknown[]): readonly (CrewSettings | null)[] | undefined {
  const query = useConsoleRead({
    queryKey: ['crew-settings', JSON.stringify(settings)],
    queryFn: () => fetchConsoleRead({ read: 'crew-settings', input: { settings: [...settings] } }),
    enabled: settings.length > 0,
    staleTime: Infinity,
  });
  return settings.length === 0 ? [] : query.data;
}
