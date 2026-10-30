import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { featureFlagsOfSession } from '../../../lib/feature-flags-of-session';
import { serverInternalUrlFrom } from '../../../lib/server-url';
import { SealingPage } from './sealing-page';

/**
 * Sealing: the fleet's sealing and its keys, Not found while the fleet's
 * sealing flag is off (decision 0069), as the web app's server reads the
 * session. The page itself is sealing-page.tsx.
 */
export default async function Page() {
  const featureFlags = await featureFlagsOfSession({ serverUrl: serverInternalUrlFrom(process.env), cookie: (await cookies()).toString() });
  if (featureFlags !== undefined && !featureFlags.includes('sealing')) {
    notFound();
  }
  return <SealingPage />;
}
