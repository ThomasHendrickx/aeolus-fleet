import type { IdGenerator } from '@aeolus-fleet/common';

import type { FleetRepository } from '../registry/public.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { overdueDelivery, overdueEvent } from './overdue.js';
import type { OverdueDeliveryRepository, PushedCrews } from './ports.js';

export interface TellOverdueTx {
  overdueDeliveries: OverdueDeliveryRepository;
  events: EventLog;
}

export type TellOverdueDeliveries = () => Promise<void>;

/**
 * Use case: one pass of the 10 and 60 minute clocks (#586, decision 0040),
 * run by core, never through the API. For every fleet, each open pushed
 * lease's oldest delivery whose clock ran out is told to argo: stored once
 * per lease and delivery with DeliveryOverdue, in one unit of work. What is
 * stored outlives the process, so a pass after a restart tells nothing again.
 */
export function createTellOverdueDeliveries(deps: {
  fleets: Pick<FleetRepository, 'list'>;
  pushedCrews: PushedCrews;
  uow: UnitOfWork<TellOverdueTx>;
  clock: Clock;
  ids: IdGenerator;
}): TellOverdueDeliveries {
  return async () => {
    for (const fleet of await deps.fleets.list()) {
      for (const crew of await deps.pushedCrews.waiting(fleet.id)) {
        const now = deps.clock.now();
        const overdue = overdueDelivery(crew, now);
        if (!overdue) {
          continue;
        }
        await deps.uow.run(async (tx) => {
          if (await tx.overdueDeliveries.tell(overdue, now)) {
            await recordEvent({ events: tx.events, ids: deps.ids }, overdueEvent(overdue, now));
          }
          return ok(undefined);
        });
      }
    }
  };
}
