'use client';

import type { Theme } from '@aeolus-fleet/common';
import { createContext, useContext } from 'react';

/**
 * The values from @aeolus-fleet/common the browser shows: limits, closed
 * sets it lists. The root layout reads them from common on the web app's
 * server and hands them down (decision 0033), so common stays out of the
 * browser and the console copies none of them.
 */
export interface ConsoleConstants {
  themes: readonly Theme[];
}

export const ConsoleConstantsContext = createContext<ConsoleConstants | undefined>(undefined);

export function useConsoleConstants(): ConsoleConstants {
  const constants = useContext(ConsoleConstantsContext);
  if (constants === undefined) {
    throw new Error('useConsoleConstants runs inside the root layout, which provides them');
  }
  return constants;
}
