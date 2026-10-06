import type { Crew } from '../shared/caller.js';
import { ok, type Result } from '../shared/result.js';
import { refuseEndedLease, type LeaseEnded } from './lease.js';
import type { LeaseRepository } from './ports.js';
import type { ShipReport } from './ship-report.js';

/** A crew's report log: its own report, and the last report of the ship's previous crew. */
export interface ReportLog {
  report: ShipReport | null;
  previousCrew: ShipReport | null;
}

export type ReadReportLog = (crew: Crew) => Promise<Result<ReportLog, LeaseEnded>>;

/**
 * Use case: the crew reads its own report whole, details included, and the
 * last report of the ship's previous crew, read-only (the crew log of the
 * previous crew), so a new crew picks up where the last one left off. No
 * scope beyond being the crew: it reads only its own ship. Refused once the
 * lease has ended.
 */
export function createReadReportLog(deps: { leases: Pick<LeaseRepository, 'findReportLog'> }): ReadReportLog {
  return async (crew) => {
    const log = await deps.leases.findReportLog(crew.fleetId, crew.leaseId);
    return log ? ok(log) : refuseEndedLease();
  };
}
