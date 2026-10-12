import type { DeliveryId, IdGenerator } from '@aeolus-fleet/common';

import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { reportTurnEnd, type ReportTurnEndRefusal, type ReportTurnEndTx } from './report-turn-end.js';

export type ReportHandled = (crew: Crew, input: { deliveryId: DeliveryId }) => Promise<Result<undefined, ReportTurnEndRefusal>>;

/**
 * Use case: a pushed crew reports the turn that took an acknowledged
 * delivery ended by itself (`handled`, decision 0040). Its scope
 * (messages:receive) is checked before this runs. In one unit of work it
 * holds the crew's lease, so a release waits for it, locks the delivery and
 * moves it to handled with DeliveryHandled. Reporting it again is OK and
 * changes nothing.
 */
export function createReportHandled(deps: { uow: UnitOfWork<ReportTurnEndTx>; clock: Clock; ids: IdGenerator }): ReportHandled {
  return (crew, input) => deps.uow.run((tx) => reportTurnEnd({ tx, clock: deps.clock, ids: deps.ids }, { crew, ...input, end: 'handled' }));
}
