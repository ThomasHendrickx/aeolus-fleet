import type { DeliveryId, IdGenerator } from '@aeolus-fleet/common';

import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { reportTurnEnd, type ReportTurnEndRefusal, type ReportTurnEndTx } from './report-turn-end.js';

export type ReportNotHandled = (crew: Crew, input: { deliveryId: DeliveryId; reason?: string }) => Promise<Result<undefined, ReportTurnEndRefusal>>;

/**
 * Use case: a pushed crew reports the turn a confirmed message was handed
 * once more to died too (`notHandled`, decision 0040). Its scope
 * (messages:receive) is checked before this runs. In one unit of work it
 * holds the crew's lease, locks the delivery and moves it to not handled
 * with DeliveryNotHandled, which keeps the reason the crew gave and puts it
 * in Needs attention. Reporting it
 * again is OK and changes nothing.
 */
export function createReportNotHandled(deps: { uow: UnitOfWork<ReportTurnEndTx>; clock: Clock; ids: IdGenerator }): ReportNotHandled {
  return (crew, input) => deps.uow.run((tx) => reportTurnEnd({ tx, clock: deps.clock, ids: deps.ids }, { crew, ...input, end: 'notHandled' }));
}
