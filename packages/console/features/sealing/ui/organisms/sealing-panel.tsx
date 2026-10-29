import type { SealingOutput } from '@aeolus-fleet/common';

import { Skeleton } from '../../../../components/atoms/skeleton';
import { InlineError } from '../../../../components/molecules/inline-error';
import { SealingKeys, type RecoveryKeyMode } from './sealing-keys';
import { SealingOff } from './sealing-off';

interface SealingPanelProps {
  /** The fleet's sealing; undefined while it loads. */
  sealing: SealingOutput | undefined;
  /** Why it could not be read. */
  error?: string;
  onRetry: () => void;
  now: Date;
  /** Offered with fleet:keys. */
  onTurnOn?: () => void;
  onChangeCompanyKey?: () => void;
  onChangeRecoveryKey?: (mode: RecoveryKeyMode) => void;
}

/** The shape that is coming while the sealing loads: the Keys card and the data keys. */
function SealingSkeleton() {
  return (
    <div role="status" aria-label="Loading sealing" className="flex flex-col gap-6" data-testid="sealing-loading">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-16 max-sm:hidden" />
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 max-sm:h-36">
          <Skeleton className="h-4 w-48 max-sm:hidden" />
          <Skeleton className="h-4 w-96 max-w-full max-sm:hidden" />
          <Skeleton className="h-4 w-36 max-sm:hidden" />
          <Skeleton className="h-4 w-72 max-w-full max-sm:hidden" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-14 max-sm:hidden" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}

/**
 * The sealing page's content (sealing page mockup, screen 1): loading, an
 * error that says nothing changed with Try again, sealing off, or the
 * sealed fleet's keys.
 */
export function SealingPanel({ sealing, error, onRetry, now, onTurnOn, onChangeCompanyKey, onChangeRecoveryKey }: SealingPanelProps) {
  if (error !== undefined) {
    return (
      <InlineError
        title="Couldn’t load sealing"
        description={
          <>
            Nothing changed. Sends and receives go on as before.
            <span className="mt-1 block font-mono text-id">fleet.sealing: {error}</span>
          </>
        }
        onRetry={onRetry}
      />
    );
  }
  if (sealing === undefined) {
    return <SealingSkeleton />;
  }
  if (sealing.state === 'none') {
    return <SealingOff onTurnOn={onTurnOn} />;
  }
  return <SealingKeys sealing={sealing} now={now} onChangeCompanyKey={onChangeCompanyKey} onChangeRecoveryKey={onChangeRecoveryKey} />;
}
