import { notFound } from 'next/navigation';

import { isStuckCause } from '../../../../features/health/services/health-view';
import { CausePage } from './cause-page';

/** One cause of Health opened, by the cause in the URL, parsed on the web app's server (decision 0033); any other word is not found. */
export default async function FleetHealthCausePage({ params }: { params: Promise<{ cause: string }> }) {
  const { cause } = await params;
  if (!isStuckCause(cause)) {
    notFound();
  }
  return <CausePage cause={cause} />;
}
