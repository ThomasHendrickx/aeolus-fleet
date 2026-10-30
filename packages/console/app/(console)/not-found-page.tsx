'use client';

import { PageNotFound } from '../../components/molecules/page-not-found';
import { DetailPage } from '../../components/organisms/detail-page';
import { useConsoleFrame } from '../../lib/console-frame';
import { useLiveFleet } from '../../lib/live-fleet';

/** The console's Not found inside the ConsoleFrame, under the Fleet overview. */
export function NotFoundPage() {
  const frame = useConsoleFrame();
  const liveFleet = useLiveFleet();

  return (
    <DetailPage
      switcher={frame.switcher}
      account={frame.account}
      onCompose={frame.onCompose}
      onSearch={frame.onSearch}
      banner={frame.banner}
      title="Page not found"
      parents={[{ href: '/', label: 'Fleet overview' }]}
      live={liveFleet.live}
      header={null}
    >
      <PageNotFound />
    </DetailPage>
  );
}
