import type { AlertId, IdGenerator } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { clearAlert, shownAlertOf, type ShownAlert } from './alert.js';
import { checkRead, keepingReachRefusal, type CheckReadTx, type NotReachable } from './check-reach.js';
import type { AlertRepository, ShipRepository } from './ports.js';

export interface ClearAlertTx extends Omit<CheckReadTx, 'ships'> {
  ships: Pick<ShipRepository, 'find' | 'findForUpdate'>;
  alerts: Pick<AlertRepository, 'find' | 'findForUpdate' | 'saveCleared'>;
  events: EventLog;
}

export type ClearAlertRefusal = DomainError<'ALERT_NOT_FOUND'> | NotReachable;

export type ClearAlert = (caller: Caller, input: { alertId: AlertId }) => Promise<Result<ShownAlert, ClearAlertRefusal>>;

/**
 * Use case: an actor holding fleet:alert, the watch, clears an open alert on
 * a ship it reads once its fact moved back (decision 0071), with
 * AlertCleared in the same unit of work; a cleared alert is answered as it
 * is. It locks the ship, then the alert, as a retire does, so a clear and a
 * retire take turns. The scope is checked before this runs; a refused read
 * keeps its record.
 */
export function createClearAlert(deps: { uow: UnitOfWork<ClearAlertTx>; clock: Clock; ids: IdGenerator }): ClearAlert {
  return (caller, { alertId }) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<ShownAlert, ClearAlertRefusal>> => {
      const { fleetId } = caller;
      const notFound = refuse('ALERT_NOT_FOUND', `Alert ${alertId} does not exist`);
      const found = await tx.alerts.find(fleetId, alertId);
      const ship = found && (await tx.ships.findForUpdate(fleetId, found.shipId));
      const alert = ship && (await tx.alerts.findForUpdate(fleetId, alertId));
      if (!ship || !alert) {
        return notFound;
      }
      const at = deps.clock.now();
      const read = await checkRead({ tx, ids: deps.ids }, { reader: caller, askedBy: null, shipId: ship.id, at });
      if (!read.isOk) {
        return read;
      }
      const cleared = clearAlert(alert, { why: 'cleared', at, actor: actorOf(caller) });
      if (cleared.events.length > 0) {
        await tx.alerts.saveCleared(cleared.alert);
      }
      for (const event of cleared.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(shownAlertOf(cleared.alert, ship));
    });
}
