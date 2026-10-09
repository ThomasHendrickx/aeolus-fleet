import { urlParamsOf } from '../lib/fleet-filter';
import { readFleetView } from '../lib/read-fleet-view';
import { OverviewPage } from './overview-page';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The fleet overview. Its search and filters come from the URL and are read
 * here, on the web app's server (decision 0033); the page itself is
 * overview-page.tsx.
 */
export default async function FleetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = urlParamsOf(await searchParams);
  // The command palette's Commission ship lands here with the dialog open.
  return <OverviewPage view={readFleetView(params)} isCommissionAsked={params.get('commission') === 'new'} />;
}
