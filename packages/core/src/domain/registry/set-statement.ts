import type { IdGenerator, Statement } from '@aeolus-fleet/common';

import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { refuseEndedLease, type LeaseEnded } from './lease.js';
import type { LeaseRepository } from './ports.js';
import { stateStatement } from './statement.js';

export interface SetStatementTx {
  leases: Pick<LeaseRepository, 'findStatementForUpdate' | 'saveStatement'>;
  events: EventLog;
}

export type SetStatement = (crew: Crew, statement: Statement) => Promise<Result<{ version: number }, LeaseEnded>>;

/**
 * Use case: the crew states what its ship is and offers (`setStatement`,
 * decision 0047), whole, its shape checked at the edge. No scope beyond being
 * the crew: it speaks only for its own ship. Kept with the crew's lease,
 * locked meanwhile, with StatementSet on a change, in one unit of work.
 * Answers the version; refused once the lease has ended.
 */
export function createSetStatement(deps: { uow: UnitOfWork<SetStatementTx>; clock: Clock; ids: IdGenerator }): SetStatement {
  return (crew, statement) =>
    deps.uow.run(async (tx): Promise<Result<{ version: number }, LeaseEnded>> => {
      const held = await tx.leases.findStatementForUpdate(crew.fleetId, crew.leaseId);
      if (!held) {
        return refuseEndedLease();
      }
      const { stated, events } = stateStatement(held.stated, { crew, statement, at: deps.clock.now() });
      if (events.length > 0) {
        await tx.leases.saveStatement({ fleetId: crew.fleetId, leaseId: crew.leaseId, stated });
      }
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ version: stated.version });
    });
}
