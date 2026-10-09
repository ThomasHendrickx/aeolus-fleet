import { idSchema } from '@aeolus-fleet/common';

import { InboxPageFor } from './inbox-page';

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * argo's inbox. The filter and the open message come from the URL; the open
 * message's id is parsed here, on the web app's server (decision 0033). The
 * page itself is inbox-page.tsx.
 */
export default async function InboxPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const filterParameter = first(query.filter);
  const selectedId = idSchema('delivery').safeParse(first(query.message)).data;
  return <InboxPageFor {...(filterParameter === undefined ? {} : { filterParameter })} {...(selectedId === undefined ? {} : { selectedId })} />;
}
