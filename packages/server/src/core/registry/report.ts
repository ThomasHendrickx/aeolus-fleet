import type { IdGenerator } from '@aeolus-fleet/common';

import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { refuseEndedLease, type LeaseEnded } from './lease.js';
import type { LeaseRepository } from './ports.js';
import { reportWork, type ReportRefusal } from './ship-report.js';

export interface ReportTx {
  leases: Pick<LeaseRepository, 'findReportForUpdate' | 'saveReport'>;
  events: EventLog;
}

export type Report = (
  crew: Crew,
  input: { state: string; note?: string },
) => Promise<Result<undefined, ReportRefusal | LeaseEnded>>;

/**
 * Use case: the crew reports what it is doing (`report`): working, blocked or
 * idle, with a short note. Calling it is a check-in. No scope beyond being the
 * crew: it speaks only for its own ship. The report is kept with the crew's
 * lease, locked meanwhile, and ShipReported is written when the state or the
 * note changed, in one unit of work. Refused once the lease has ended.
 */
export function createReport(deps: { uow: UnitOfWork<ReportTx>; clock: Clock; ids: IdGenerator }): Report {
  return (crew, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, ReportRefusal | LeaseEnded>> => {
      const held = await tx.leases.findReportForUpdate(crew.fleetId, crew.leaseId);
      if (!held) {
        return refuseEndedLease();
      }
      const reported = reportWork(held.report, { crew, state: input.state, note: input.note, at: deps.clock.now() });
      if (!reported.isOk) {
        return reported;
      }
      await tx.leases.saveReport({ fleetId: crew.fleetId, leaseId: crew.leaseId, report: reported.value.report });
      for (const event of reported.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
