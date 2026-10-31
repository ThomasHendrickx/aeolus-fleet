import type { IdGenerator, RaiseAlertInput } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { raiseAlert, shownAlertOf, type RaiseAlertRefusal, type ShownAlert } from './alert.js';
import { checkRead, keepingReachRefusal, type CheckReadTx, type NotReachable } from './check-reach.js';
import type { AlertRepository, ShipRepository } from './ports.js';

export interface RaiseAlertTx extends Omit<CheckReadTx, 'ships'> {
  ships: Pick<ShipRepository, 'find' | 'findForUpdate'>;
  alerts: Pick<AlertRepository, 'findByOccurrence' | 'create'>;
  events: EventLog;
}

export type RaiseAlertUseCaseRefusal = DomainError<'SHIP_NOT_FOUND'> | NotReachable | RaiseAlertRefusal;

export type RaiseAlert = (caller: Caller, input: RaiseAlertInput) => Promise<Result<ShownAlert, RaiseAlertUseCaseRefusal>>;

/**
 * Use case: an actor holding fleet:alert, the watch, raises an alert on a
 * ship it reads (decision 0071, docs/design/monitoring 4.5), naming the
 * ship's owner now, with AlertRaised in the same unit of work. The same
 * occurrence answers the alert held, open or cleared, with no event: two
 * passes of the watch raise one alert. It locks the ship, as a retire does,
 * so two raises take turns and none lands on a ship a retire passed by. The
 * scope is checked before this runs; a refused read keeps its record.
 */
export function createRaiseAlert(deps: { uow: UnitOfWork<RaiseAlertTx>; clock: Clock; ids: IdGenerator }): RaiseAlert {
  return (caller, { shipId, since, ...raised }) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<ShownAlert, RaiseAlertUseCaseRefusal>> => {
      const { fleetId } = caller;
      const ship = await tx.ships.findForUpdate(fleetId, shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${shipId} does not exist`);
      }
      const at = deps.clock.now();
      const read = await checkRead({ tx, ids: deps.ids }, { reader: caller, askedBy: null, shipId, at });
      if (!read.isOk) {
        return read;
      }
      const held = await tx.alerts.findByOccurrence(fleetId, { shipId, signal: raised.signal, occurrenceKey: raised.occurrenceKey });
      const result = raiseAlert(ship, { held, id: deps.ids('alert'), alert: { ...raised, since: new Date(since) }, at, actor: actorOf(caller) });
      if (!result.isOk) {
        return result;
      }
      const { alert, events } = result.value;
      if (events.length > 0) {
        await tx.alerts.create(alert);
      }
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(shownAlertOf(alert, ship));
    });
}
