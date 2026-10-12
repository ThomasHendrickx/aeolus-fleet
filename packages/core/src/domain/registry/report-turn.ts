import type { IdGenerator, TurnState } from '@aeolus-fleet/common';

import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { refuseEndedLease, type LeaseEnded } from './lease.js';
import type { LeaseRepository } from './ports.js';
import { reportTurn } from './turn.js';

export interface ReportTurnTx {
  leases: Pick<LeaseRepository, 'findTurnForUpdate' | 'saveTurn'>;
  events: EventLog;
}

export type ReportTurn = (crew: Crew, input: { turn: TurnState; at: Date }) => Promise<Result<undefined, LeaseEnded>>;

/**
 * Use case: a pushed ship's hooks report its session's turn (`turn`,
 * decision 0040), idle or busy, with the time they saw it. No scope beyond
 * being the crew: it speaks only for its own session. The turn is kept with
 * the crew's lease, locked meanwhile, and TurnReported is written when it
 * changed, in one unit of work. Refused once the lease has ended.
 */
export function createReportTurn(deps: { uow: UnitOfWork<ReportTurnTx>; clock: Clock; ids: IdGenerator }): ReportTurn {
  return (crew, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, LeaseEnded>> => {
      const held = await tx.leases.findTurnForUpdate(crew.fleetId, crew.leaseId);
      if (!held) {
        return refuseEndedLease();
      }
      const { turn, events } = reportTurn(held.turn, { crew, ...input, now: deps.clock.now() });
      if (events.length > 0) {
        await tx.leases.saveTurn({ fleetId: crew.fleetId, leaseId: crew.leaseId, turn });
      }
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
