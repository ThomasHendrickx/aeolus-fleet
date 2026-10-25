import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import { checkManage, type CheckManageTx, type NotReachable } from '../registry/public.js';
import { hasScope, isShipCaller, type Caller } from '../shared/caller.js';
import { ok, type Result } from '../shared/result.js';

/** How an actor reaches a ship's schedules: as that ship, as a manager of it, or not at all. */
export type ScheduleAccess = 'ship' | 'manager' | 'none';

/**
 * Who may list and cancel a ship's schedules (decision 0062, S10): the ship
 * itself, and an actor holding fleet:manage within manage reach of it, so
 * argo always removes one. A manager outside its manage reach is refused, the
 * refusal recorded in the caller's unit of work.
 */
export async function scheduleAccess(
  deps: { tx: CheckManageTx; ids: IdGenerator },
  access: { caller: Caller; shipId: ShipId; at: Date },
): Promise<Result<ScheduleAccess, NotReachable>> {
  const { caller, shipId, at } = access;
  if (isShipCaller(caller) && caller.shipId === shipId) {
    return ok('ship');
  }
  if (!hasScope(caller, 'fleet:manage')) {
    return ok('none');
  }
  const managed = await checkManage(deps, { manager: caller, shipId, at });
  return managed.isOk ? ok('manager') : managed;
}
