/** Account-readable context excludes the full current direct sendable set in SQL. */
import type { PersonShipPageInput, ReadableContextShipsOutput } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { ok, type Result } from '../shared/result.js';
import { personShipPageOf, personShipPagePosition } from './person-ship-page.js';
import { personShipReadPermission, personShipSendPermission } from './person-ship-permissions.js';
import type { PersonReadUnitOfWork } from './person-read-unit-of-work.js';
import type { PersonShipReadRefusal, PersonShipReadTx } from './person-ship-reads.js';

export type ReadableContextShips = (caller: Caller, input: PersonShipPageInput) => Promise<Result<ReadableContextShipsOutput, PersonShipReadRefusal>>;

export function createReadableContextShips(deps: { uow: PersonReadUnitOfWork<PersonShipReadTx> }): ReadableContextShips {
  return async (caller, input) => {
    const position = personShipPagePosition(caller, { input, section: 'readableContext' });
    if (!position.isOk) {
      return position;
    }
    return deps.uow.run(caller.fleetId, async (tx): Promise<Result<ReadableContextShipsOutput, PersonShipReadRefusal>> => {
      const facts = await tx.facts.find(caller, { verbs: ['read', 'send'] });
      const reader = personShipReadPermission(facts);
      if (!reader.isOk) {
        return reader;
      }
      const rows = await tx.projection.page(caller.fleetId, { ...position.value, policy: { section: 'readableContext', reader: reader.value, sender: personShipSendPermission(facts) } });
      const page = personShipPageOf(position.value, rows);
      if (page.selected.length === 0) {
        return ok({ rows: [], nextCursor: page.nextCursor });
      }
      const reports = await tx.projection.selectedReports(caller.fleetId, page.selected);
      const byShip = new Map(reports.rows.map(({ shipId, report }) => [shipId, report]));
      return ok({ rows: page.selected.map(({ row }) => ({ ...row, report: byShip.get(row.shipId) ?? { status: 'unavailable' } })), nextCursor: page.nextCursor });
    });
  };
}
