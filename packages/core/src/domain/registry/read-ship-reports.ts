/** Only loaded resource ids are enriched, under the authenticated reader's rights. */
import type { ShipReportsInput, ShipReportsOutput } from '@aeolus-fleet/common';

import { hasScope, type Caller } from '../shared/caller.js';
import { refuse } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { personShipReadPermission } from './person-ship-permissions.js';
import type { PersonReadUnitOfWork } from './person-read-unit-of-work.js';
import type { PersonShipReadRefusal, PersonShipReadTx } from './person-ship-reads.js';

export type ReadShipReports = (caller: Caller, input: ShipReportsInput) => Promise<Result<ShipReportsOutput, PersonShipReadRefusal>>;

export function createReadShipReports(deps: { uow: PersonReadUnitOfWork<PersonShipReadTx> }): ReadShipReports {
  return async (caller, input) => {
    if (!hasScope(caller, 'fleet:read')) {
      return refuse('SCOPE_NOT_HELD', 'This call needs the fleet:read scope');
    }
    if (input.shipIds.length === 0) {
      return ok({ rows: [] });
    }
    return deps.uow.run(caller.fleetId, async (tx): Promise<Result<ShipReportsOutput, PersonShipReadRefusal>> => {
      const permission = personShipReadPermission(await tx.facts.find(caller, { verbs: ['read'] }));
      return permission.isOk ? ok(await tx.projection.reports(caller.fleetId, { permission: permission.value, shipIds: input.shipIds })) : permission;
    });
  };
}
