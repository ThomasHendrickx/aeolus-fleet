'use client';

import { createContext, useContext } from 'react';

/**
 * Whether this installation runs the account app (AEOLUS_ACCOUNT_APP_URL),
 * read by the web app's server per request. Without it the installation is
 * a single-app one: Console alone (docs/design/app-navigation, section 4).
 */
export const AccountAppContext = createContext(false);

export function useHasAccountApp(): boolean {
  return useContext(AccountAppContext);
}
