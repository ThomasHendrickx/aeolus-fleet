import type { ActivityKind, ShipId } from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { checkRunsShip } from './crew-request.js';
import type { CrewRequestRepository, LeaseRepository, ShipRepository } from './ports.js';

export interface ReportActivityTx {
  ships: Pick<ShipRepository, 'find'>;
  crewRequests: Pick<CrewRequestRepository, 'find'>;
  leases: Pick<LeaseRepository, 'saveActivity'>;
}

export type ActivityRefusal = DomainError<'SHIP_NOT_FOUND' | 'CREW_REQUEST_NOT_FOUND' | 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER' | 'SHIP_NOT_CREWED'>;

export type ReportActivity = (
  caller: ShipCaller,
  input: { intervalSeconds: number; activities: readonly { shipId: ShipId; at: string; kind: ActivityKind; tool?: string }[] },
) => Promise<Result<{ refused: { shipId: ShipId; error: ActivityRefusal }[] }, never>>;

/**
 * Use case: the assigned trierarch writes the activity of the crewed ships it
 * runs, many in one call (docs/design/monitoring, 4.3), each with the report
 * interval it states and the time it wrote it. Each entry is taken only for a
 * ship whose crew request is assigned to the caller's ship and that a session
 * crews; any other is refused for that entry and the rest are taken. No
 * event: a session's activity is not a fleet change. Its scope (crew:run) is
 * checked before this runs. One unit of work, each entry writing only its
 * ship's open lease.
 */
export function createReportActivity(deps: { uow: UnitOfWork<ReportActivityTx>; clock: Clock }): ReportActivity {
  return (caller, input) =>
    deps.uow.run(async (tx) => {
      const reportedAt = deps.clock.now();
      const refused: { shipId: ShipId; error: ActivityRefusal }[] = [];
      for (const entry of input.activities) {
        const written = await writeActivity(tx, { caller, entry, intervalSeconds: input.intervalSeconds, reportedAt });
        if (!written.isOk) {
          refused.push({ shipId: entry.shipId, error: written.error });
        }
      }
      return ok({ refused });
    });
}

async function writeActivity(
  tx: ReportActivityTx,
  { caller, entry, intervalSeconds, reportedAt }: { caller: ShipCaller; entry: Parameters<ReportActivity>[1]['activities'][number]; intervalSeconds: number; reportedAt: Date },
): Promise<Result<void, ActivityRefusal>> {
  const ship = await tx.ships.find(caller.fleetId, entry.shipId);
  if (!ship) {
    return refuse('SHIP_NOT_FOUND', `Ship ${entry.shipId} does not exist`);
  }
  const runs = checkRunsShip({ ship, current: await tx.crewRequests.find(caller.fleetId, ship.id), trierarchShipId: caller.shipId });
  if (!runs.isOk) {
    return runs;
  }
  const isCrewed = await tx.leases.saveActivity({
    fleetId: caller.fleetId,
    shipId: ship.id,
    activity: { at: new Date(entry.at), kind: entry.kind, tool: entry.tool ?? null, reportedAt, intervalSeconds },
  });
  return isCrewed ? ok(undefined) : refuse('SHIP_NOT_CREWED', `${ship.name} is not crewed`);
}
