import type { TurnState } from '@aeolus-fleet/common';

import { actorOf, type Crew } from '../shared/caller.js';
import type { NewEvent } from '../shared/events.js';

/** The turn a lease holds: idle or busy, since the time the hooks saw it change. */
export interface Turn {
  state: TurnState;
  at: Date;
}

/**
 * The hooks report the turn with the time they saw it (decision 0040): the
 * lease keeps it at that time, and TurnReported is written then, so a report
 * the fleet refused and that is sent again later keeps its own time. The same
 * turn again changes nothing, so the turn keeps the time it changed. A report
 * older than the turn held changes nothing either: a late report never undoes
 * a newer one. A time later than now is taken as now.
 */
export function reportTurn(
  held: Turn | null,
  report: { crew: Crew; turn: TurnState; at: Date; now: Date },
): { turn: Turn; events: NewEvent[] } {
  const { crew, turn, now } = report;
  const at = report.at > now ? now : report.at;
  if (held !== null && (held.state === turn || at < held.at)) {
    return { turn: held, events: [] };
  }
  return {
    turn: { state: turn, at },
    events: [
      {
        fleetId: crew.fleetId,
        type: 'TurnReported',
        occurredAt: at,
        actor: actorOf(crew),
        shipId: crew.shipId,
        details: { leaseId: crew.leaseId, turn },
      },
    ],
  };
}
