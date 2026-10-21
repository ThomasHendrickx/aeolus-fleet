'use client';

import { createContext, useContext } from 'react';

/**
 * Whether this console signs argo in with its own email and password: unless
 * AEOLUS_HOSTED_SIGN_IN_URL sends sign-in to the hosting service, read by the
 * web app's server per request (accounts design, A1). Settings then offers
 * the email and password; the fleet still refuses them on a hosted fleet.
 */
export const OwnSignInContext = createContext(false);

export function useHasOwnSignIn(): boolean {
  return useContext(OwnSignInContext);
}
