'use client';

import { createContext, useContext } from 'react';

/**
 * Where a hosted operator's account lists the fleet's limits, from
 * AEOLUS_HOSTED_ACCOUNT_URL, read by the web app's server per request. None
 * without it: the limit notices then say where limits live, with no link.
 */
export const HostedAccountUrlContext = createContext<string | undefined>(undefined);

export function useHostedAccountUrl(): string | undefined {
  return useContext(HostedAccountUrlContext);
}
