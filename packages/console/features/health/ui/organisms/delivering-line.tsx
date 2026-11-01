import type { Health } from '@aeolus-fleet/common';

import { StatusBadge } from '../../../../components/molecules/status-badge';
import { duration } from '../../../../lib/relative-time';
import { medianText } from '../../services/health-view';
import { AcknowledgedBars } from '../molecules/acknowledged-bars';

/**
 * The good news under the verdict (mock-up A): how many deliveries were
 * acknowledged in the last 24 hours, the median from send to
 * acknowledgement, and the hours as bars, so every stuck count has a
 * denominator.
 */
export function DeliveringLine({ acknowledged }: { acknowledged: Health['acknowledged'] }) {
  return (
    <section
      aria-label="Delivering"
      data-testid="health-delivering"
      className="flex items-center gap-4 rounded-lg border border-border bg-card p-3 max-sm:flex-col max-sm:items-start max-sm:gap-3 max-sm:rounded-xl"
    >
      <StatusBadge status="delivering" />
      <p className="flex-1 text-body text-foreground max-sm:text-body-touch">
        {acknowledged.medianMs === null ? (
          'Nothing acknowledged in the last 24 h.'
        ) : (
          <>
            <span className="font-semibold tabular-nums">{acknowledged.count}</span> acknowledged in the last 24 h, median{' '}
            <span className="font-semibold tabular-nums">{medianText(acknowledged.medianMs, duration)}</span> from send to acknowledgement.
          </>
        )}
      </p>
      <AcknowledgedBars perHour={acknowledged.perHour} />
    </section>
  );
}
