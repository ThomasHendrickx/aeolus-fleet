'use client';

import { UsageContainer } from '../../../features/usage/state/usage-container';
import type { UsageState } from '../../../features/usage/services/usage-state';

/** The Usage page's client part: the page's state, read from the URL on the server, over the reads. */
export function UsagePageFor({ view }: { view: UsageState }) {
  return <UsageContainer view={view} />;
}
