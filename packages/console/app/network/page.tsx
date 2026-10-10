import { idSchema } from '@aeolus-fleet/common';

import { NetworkPageFor } from './network-page';

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Network. The ship argo picked on the fleet graph comes from the URL, its id
 * parsed here, on the web app's server (decision 0033). The page itself is
 * network-page.tsx.
 */
export default async function NetworkPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const pickedShipId = idSchema('ship').safeParse(first(query.reach)).data;
  return <NetworkPageFor {...(pickedShipId === undefined ? {} : { pickedShipId })} />;
}
