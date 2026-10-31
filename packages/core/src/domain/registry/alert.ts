/**
 * Alerts (decision 0071, docs/design/monitoring 4.5): what the watch raised
 * on a ship when a fact and its signal parted, held by core until the watch
 * clears it or the ship retires. One per ship, signal and occurrence: the
 * same occurrence answers the alert held, open or cleared, so a fact that
 * flaps is never raised twice. Core compares nothing: the signal and its
 * facts are the watch's, their shape common's.
 */
import type { AlertClearedWhy, AlertId, AlertSignalFacts, FleetId, ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { Ship } from './ship.js';

/** An alert on a ship: its signal with the facts at raise, the occurrence it is unique by, the owner told, and when it cleared, null while open. */
export type Alert = {
  fleetId: FleetId;
  id: AlertId;
  shipId: ShipId;
  occurrenceKey: string;
  /** The ship's owner when the alert was raised: the one the watch tells. Null for a ship no ship owns. */
  ownerShipId: ShipId | null;
  since: Date;
  raisedAt: Date;
  cleared: { at: Date; why: AlertClearedWhy } | null;
} & AlertSignalFacts;

/** An alert as a reader sees it: its ship by id and name. */
export type ShownAlert = {
  id: AlertId;
  ship: { id: ShipId; name: string };
  occurrenceKey: string;
  ownerShipId: ShipId | null;
  since: Date;
  raisedAt: Date;
  cleared: Alert['cleared'];
} & AlertSignalFacts;

/** What a raise asks: the signal with its facts, the occurrence and since when. */
export type AlertRaise = { occurrenceKey: string; since: Date } & AlertSignalFacts;

export type RaiseAlertRefusal = DomainError<'SHIP_ALREADY_RETIRED'>;

/** The alert as a reader sees it, on its ship. */
export function shownAlertOf(alert: Alert, ship: Pick<Ship, 'id' | 'name'>): ShownAlert {
  const { id, occurrenceKey, ownerShipId, since, raisedAt, cleared } = alert;
  return { id, ship: { id: alert.shipId, name: ship.name }, occurrenceKey, ownerShipId, since, raisedAt, cleared, ...signalFactsOf(alert) };
}

/** The alert's signal with its facts, apart from the rest of it. */
export function signalFactsOf(alert: AlertSignalFacts): AlertSignalFacts {
  switch (alert.signal) {
    case 'crew-request-unassigned':
      return { signal: alert.signal, facts: alert.facts };
    case 'delivery-unacknowledged':
      return { signal: alert.signal, facts: alert.facts };
    case 'delivery-overdue':
      return { signal: alert.signal, facts: alert.facts };
    case 'ping-unanswered':
      return { signal: alert.signal, facts: alert.facts };
    case 'report-unchanged':
      return { signal: alert.signal, facts: alert.facts };
    case 'task-not-done':
      return { signal: alert.signal, facts: alert.facts };
  }
}

/**
 * Raises an alert on a ship that is not retired, naming its owner now, with
 * AlertRaised on the ship; the alert held for the occurrence, open or
 * cleared, is answered as it is, with no event.
 */
export function raiseAlert(
  ship: Ship,
  raise: { held: Alert | undefined; id: AlertId; alert: AlertRaise; at: Date; actor: Actor },
): Result<{ alert: Alert; events: NewEvent[] }, RaiseAlertRefusal> {
  if (raise.held !== undefined) {
    return ok({ alert: raise.held, events: [] });
  }
  if (ship.retiredAt !== null) {
    return refuse('SHIP_ALREADY_RETIRED', `Ship ${ship.name} is retired: it takes no alert`);
  }
  const alert: Alert = { ...raise.alert, fleetId: ship.fleetId, id: raise.id, shipId: ship.id, ownerShipId: ship.owner, raisedAt: raise.at, cleared: null };
  return ok({
    alert,
    events: [
      {
        fleetId: ship.fleetId,
        type: 'AlertRaised',
        occurredAt: raise.at,
        actor: raise.actor,
        shipId: ship.id,
        details: { alertId: alert.id, signal: alert.signal, occurrenceKey: alert.occurrenceKey },
      },
    ],
  });
}

/** Clears an open alert, with AlertCleared on its ship saying why; a cleared one is answered as it is, with no event. */
export function clearAlert(alert: Alert, clear: { why: AlertClearedWhy; at: Date; actor: Actor }): { alert: Alert; events: NewEvent[] } {
  if (alert.cleared !== null) {
    return { alert, events: [] };
  }
  return {
    alert: { ...alert, cleared: { at: clear.at, why: clear.why } },
    events: [
      {
        fleetId: alert.fleetId,
        type: 'AlertCleared',
        occurredAt: clear.at,
        actor: clear.actor,
        shipId: alert.shipId,
        details: { alertId: alert.id, signal: alert.signal, why: clear.why },
      },
    ],
  };
}
