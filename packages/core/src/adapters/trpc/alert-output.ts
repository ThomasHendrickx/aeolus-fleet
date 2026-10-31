import type { AlertOutput } from '@aeolus-fleet/common';

import { signalFactsOf, type ShownAlert } from '../../domain/registry/alert.js';

/** An alert as `fleet.raiseAlert`, `fleet.clearAlert`, `fleet.openAlerts` and `fleet.ship` answer it (decision 0071): times in ISO 8601. */
export function alertOutputOf(alert: ShownAlert): AlertOutput {
  return {
    id: alert.id,
    ship: alert.ship,
    occurrenceKey: alert.occurrenceKey,
    ownerShipId: alert.ownerShipId,
    since: alert.since.toISOString(),
    raisedAt: alert.raisedAt.toISOString(),
    cleared: alert.cleared && { at: alert.cleared.at.toISOString(), why: alert.cleared.why },
    ...signalFactsOf(alert),
  };
}
