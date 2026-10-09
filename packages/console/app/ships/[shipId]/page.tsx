import { idSchema } from '@aeolus-fleet/common';

import { shipTabOf } from '../../../lib/ship-tab';
import { ShipPageFor } from './ship-page';

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * A ship's page. Its id, tab and open message come from the URL and are
 * parsed here, on the web app's server (decision 0033); the page itself is
 * ship-page.tsx.
 */
export default async function ShipPage({ params, searchParams }: { params: Promise<{ shipId: string }>; searchParams: Promise<SearchParams> }) {
  const parsed = idSchema('ship').safeParse((await params).shipId);
  const query = await searchParams;
  // A malformed id names no ship; any well-formed one is looked up, so the
  // header says Ship not found either way.
  const shipId = parsed.success ? parsed.data : idSchema('ship').parse(`shp_${'0'.repeat(26)}`);
  const tab = shipTabOf(first(query.tab));
  const messageId = idSchema('message').safeParse(first(query.message)).data;
  return <ShipPageFor shipId={shipId} tab={tab} {...(messageId === undefined ? {} : { messageId })} />;
}
