import { idSchema } from '@aeolus-fleet/common';

import { usageStateOf } from '../../../features/usage/services/usage-state';
import { UsagePageFor } from './usage-page';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Usage over time. The page's state (range, split, measure, filters) comes
 * from the URL and is read here, on the web app's server, with the ship ids
 * parsed (decision 0033); the page itself is usage-page.tsx.
 */
export default async function UsagePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const view = usageStateOf(await searchParams, (value) => idSchema('ship').safeParse(value).data);
  return <UsagePageFor view={view} />;
}
