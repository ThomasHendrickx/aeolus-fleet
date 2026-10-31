import type { AlertOutput } from '@aeolus-fleet/common';

import { AlertPanel } from '../../../../components/molecules/alert-panel';
import { alertOverviewLine } from '../../../../lib/alert';

/**
 * Open alerts above the fleet table (docs/design/monitoring, 4.8): one line
 * each, newest first: the ship, what parted, since when, "clears by itself".
 * Nothing while none is open. The count reads "20+" while more are open than
 * the page holds.
 */
export function OpenAlerts({ alerts, hasMore, now }: { alerts: readonly AlertOutput[]; hasMore: boolean; now: Date }) {
  if (alerts.length === 0) {
    return null;
  }
  return (
    <AlertPanel
      heading={`Open alerts · ${String(alerts.length)}${hasMore ? '+' : ''}`}
      lines={alerts.map((alert) => ({ key: alert.id, ...alertOverviewLine(alert, now) }))}
      testId="fleet-open-alerts"
    />
  );
}
