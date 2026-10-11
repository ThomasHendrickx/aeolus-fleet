import { idSchema } from '@aeolus-fleet/common';

import { QuestionsPageFor } from './questions-page';

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Questions to argo (decision 0038). The filter and the open question come
 * from the URL; the open question's id is parsed here, on the web app's
 * server (decision 0033). The page itself is questions-page.tsx.
 */
export default async function QuestionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const filterParameter = first(query.filter);
  const selectedId = idSchema('delivery').safeParse(first(query.question)).data;
  return <QuestionsPageFor {...(filterParameter === undefined ? {} : { filterParameter })} {...(selectedId === undefined ? {} : { selectedId })} />;
}
