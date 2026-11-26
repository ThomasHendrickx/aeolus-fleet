import type { IdGenerator, ReportActivityInput, ShipId } from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { checkRunsShip } from './crew-request.js';
import type { CrewRequestRepository, LeaseRepository, ShipRepository } from './ports.js';

export interface ReportActivityTx {
  ships: Pick<ShipRepository, 'find'>;
  crewRequests: Pick<CrewRequestRepository, 'find'>;
  leases: Pick<LeaseRepository, 'saveActivity'>;
  events: EventLog;
}

export type ActivityRefusal = DomainError<'SHIP_NOT_FOUND' | 'CREW_REQUEST_NOT_FOUND' | 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER' | 'SHIP_NOT_CREWED'>;

type ActivityObservation = ReportActivityInput['activities'][number];

export type ReportActivity = (
  caller: ShipCaller,
  input: { intervalSeconds: number; activities: readonly ActivityObservation[] },
) => Promise<Result<{ refused: { shipId: ShipId; error: ActivityRefusal }[] }, never>>;

/**
 * Use case: the assigned trierarch writes the activity of the crewed ships it
 * runs, many in one call (docs/design/monitoring, 4.3), each with the report
 * interval it states and the time it wrote it. Each entry is taken only for a
 * ship whose crew request is assigned to the caller's ship and that a session
 * crews; any other is refused for that entry and the rest are taken. Each
 * tool call also goes to the ship's timeline in the same unit of work.
 * The caller's scope (crew:run) is checked before this runs.
 */
export function createReportActivity(deps: { uow: UnitOfWork<ReportActivityTx>; clock: Clock; ids: IdGenerator }): ReportActivity {
  return (caller, input) =>
    deps.uow.run(async (tx) => {
      const reportedAt = deps.clock.now();
      const byShip = Map.groupBy(input.activities, (entry) => entry.shipId);
      const refusals = new Map<ShipId, ActivityRefusal>();
      // Take lease locks in ship order and retain the observation order within each ship.
      for (const [shipId, observations] of [...byShip].sort(([first], [second]) => first.localeCompare(second))) {
        const written = await writeActivity(tx, { caller, shipId, observations, intervalSeconds: input.intervalSeconds, reportedAt, ids: deps.ids });
        if (!written.isOk) {
          refusals.set(shipId, written.error);
        }
      }
      const refused = input.activities.flatMap(({ shipId }) => {
        const error = refusals.get(shipId);
        return error === undefined ? [] : [{ shipId, error }];
      });
      return ok({ refused });
    });
}

async function writeActivity(
  tx: ReportActivityTx,
  { caller, shipId, observations, intervalSeconds, reportedAt, ids }: {
    caller: ShipCaller;
    shipId: ShipId;
    observations: readonly ActivityObservation[];
    intervalSeconds: number;
    reportedAt: Date;
    ids: IdGenerator;
  },
): Promise<Result<void, ActivityRefusal>> {
  const latest = observations.at(-1);
  if (latest === undefined) {
    return ok(undefined);
  }
  const ship = await tx.ships.find(caller.fleetId, shipId);
  if (!ship) {
    return refuse('SHIP_NOT_FOUND', `Ship ${shipId} does not exist`);
  }
  const runs = checkRunsShip({ ship, current: await tx.crewRequests.find(caller.fleetId, ship.id), trierarchShipId: caller.shipId });
  if (!runs.isOk) {
    return runs;
  }
  const leaseId = await tx.leases.saveActivity({
    fleetId: caller.fleetId,
    shipId: ship.id,
    activity: { at: new Date(latest.at), kind: latest.kind, tool: latest.tool ?? null, reportedAt, intervalSeconds },
  });
  if (leaseId === undefined) {
    return refuse('SHIP_NOT_CREWED', `${ship.name} is not crewed`);
  }
  for (const entry of observations) {
    if (entry.kind === 'tool' || entry.kind === 'refused') {
      const tool = entry.tool ?? null;
      await recordEvent({ events: tx.events, ids }, {
        fleetId: caller.fleetId,
        type: 'ToolCallObserved',
        occurredAt: new Date(entry.at),
        actor: shipActor(caller.shipId),
        shipId: ship.id,
        details: entry.kind === 'refused' ? { leaseId, tool, outcome: 'refused', reason: entry.reason } : { leaseId, tool, outcome: 'allowed' },
      });
    }
  }
  return ok(undefined);
}
