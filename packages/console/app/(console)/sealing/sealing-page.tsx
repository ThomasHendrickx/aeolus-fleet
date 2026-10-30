'use client';

import { DetailPage } from '../../../components/organisms/detail-page';
import { Sealing } from '../../../features/sealing/state/sealing';
import { useConsoleFrame } from '../../../lib/console-frame';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useSignInWhenSessionEnds } from '../../../lib/session';

const DESCRIPTION = 'Payloads in this fleet under your company’s own key. Metadata, reports and statements stay readable.';

/**
 * Sealing (sealing page mockup, screen 1; ES1): Fleet overview › Sealing.
 * Where sealing stands, the company key, the recovery key and the data keys,
 * for every session holding fleet:read; turning it on and changing keys with
 * fleet:keys.
 */
export function SealingPage() {
  const frame = useConsoleFrame();
  const liveFleet = useLiveFleet();
  useSignInWhenSessionEnds([liveFleet.error]);

  return (
    <DetailPage
      switcher={frame.switcher}
      account={frame.account}
      onCompose={frame.onCompose}
      onSearch={frame.onSearch}
      banner={frame.banner}
      title="Sealing"
      parents={[{ href: '/', label: 'Fleet overview' }]}
      live={liveFleet.live}
      header={
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-title font-semibold tracking-tight max-sm:text-title-touch">Sealing</h1>
          <p className="text-meta text-muted-foreground max-sm:text-body-touch">{DESCRIPTION}</p>
        </div>
      }
    >
      <Sealing />
    </DetailPage>
  );
}
