/**
 * A crew's statement (decision 0047): what its ship is and offers, kept with
 * the lease and versioned, so it goes when the lease ends and the next crew
 * starts with none. Its shape is common's, checked at the edge; nothing here
 * acts on it. Until a crew states one, the commission note stands in.
 */
import type { DiscoveredStatement, Statement } from '@aeolus-fleet/common';

import { actorOf, type Crew } from '../shared/caller.js';
import type { NewEvent } from '../shared/events.js';

/** The statement a lease holds, with its version: 1 for the first, one more on every change. */
export interface StatedStatement {
  statement: Statement;
  version: number;
}

/**
 * The crew states its statement, whole: at the next version, with
 * StatementSet caused by its ship, holding the lease, the version and how
 * many capabilities, never the statement. The same statement again changes
 * nothing and writes no event.
 */
export function stateStatement(
  current: StatedStatement | null,
  input: { crew: Crew; statement: Statement; at: Date },
): { stated: StatedStatement; events: NewEvent[] } {
  const { crew, statement, at } = input;
  if (current !== null && canonicalJson(current.statement) === canonicalJson(statement)) {
    return { stated: current, events: [] };
  }
  const stated: StatedStatement = { statement, version: (current?.version ?? 0) + 1 };
  return {
    stated,
    events: [
      {
        fleetId: crew.fleetId,
        type: 'StatementSet',
        occurredAt: at,
        actor: actorOf(crew),
        shipId: crew.shipId,
        details: { leaseId: crew.leaseId, version: stated.version, capabilities: statement.capabilities.length },
      },
    ],
  };
}

/** A ship's statement as discovery shows it: its crew's while one is stated, else its commission note, else none. */
export function discoveredStatementOf(ship: { note: string | null }, stated: StatedStatement | null): DiscoveredStatement {
  if (stated !== null) {
    return { by: 'crew', version: stated.version, ...stated.statement };
  }
  return ship.note === null ? null : { by: 'commission', note: ship.note };
}

/** JSON with every object's keys in order, so two statements that differ only in key order are the same. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, held: unknown) =>
    held !== null && typeof held === 'object' && !Array.isArray(held) ? Object.fromEntries(Object.entries(held).sort(([one], [other]) => one.localeCompare(other))) : held,
  );
}
