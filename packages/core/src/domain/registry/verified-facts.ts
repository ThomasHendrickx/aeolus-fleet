/**
 * Verified facts (decision 0059): what an actor checked about a ship, kept
 * with the ship per writer, each writer's set whole. Like a statement, a
 * claim by its writer: its shape is common's, checked at the edge, and
 * nothing here acts on it.
 */
import type { AccountId, DiscoveredVerifiedFact, FleetId, ShipId, VerifiedFact } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { Ship } from './ship.js';

/** Who wrote a fact, as decision 0057 names an actor: an account by its id only. */
export type FactWriter = { kind: 'ship'; shipId: ShipId } | { kind: 'account'; accountId: AccountId } | { kind: 'installation' };

/** One writer's facts about one ship, written at one time. */
export interface WrittenFacts {
  fleetId: FleetId;
  shipId: ShipId;
  writer: FactWriter;
  facts: readonly VerifiedFact[];
  at: Date;
}

export type SetVerifiedFactsRefusal = DomainError<'SHIP_ALREADY_RETIRED'>;

/** The writer a caller writes as. */
export function writerOf(caller: Caller): FactWriter {
  switch (caller.kind) {
    case 'account':
      return { kind: 'account', accountId: caller.accountId };
    case 'installation':
      return { kind: 'installation' };
    case 'operator':
    case 'viewer':
    case 'agent':
    case 'person':
    case 'app':
      return { kind: 'ship', shipId: caller.shipId };
  }
}

/** Whether two writers are the same actor. */
export function isSameWriter(writer: FactWriter, other: FactWriter): boolean {
  switch (writer.kind) {
    case 'ship':
      return other.kind === 'ship' && other.shipId === writer.shipId;
    case 'account':
      return other.kind === 'account' && other.accountId === writer.accountId;
    case 'installation':
      return other.kind === 'installation';
  }
}

/**
 * A writer sets its facts about a ship, whole: none withdraws them. Refused
 * on a retired ship. The same facts again, in the same order, change nothing
 * and write no event; a change writes VerifiedFactsSet on the ship, caused by
 * the writer, with how many facts and never their values.
 */
export function setVerifiedFacts(
  ship: Ship,
  input: { current: WrittenFacts | undefined; writer: FactWriter; facts: readonly VerifiedFact[]; at: Date; actor: Actor },
): Result<{ written: WrittenFacts | null; events: NewEvent[] }, SetVerifiedFactsRefusal> {
  const { current, writer, facts, at, actor } = input;
  if (ship.retiredAt !== null) {
    return refuse('SHIP_ALREADY_RETIRED', `${ship.name} is retired: no fact is written about it`);
  }
  const before = current?.facts ?? [];
  if (factsKey(before) === factsKey(facts)) {
    return ok({ written: current ?? null, events: [] });
  }
  return ok({
    written: facts.length === 0 ? null : { fleetId: ship.fleetId, shipId: ship.id, writer, facts, at },
    events: [{ fleetId: ship.fleetId, type: 'VerifiedFactsSet', occurredAt: at, actor, shipId: ship.id, details: { facts: facts.length } }],
  });
}

/** The facts in order, each as its check, issuer and value, whatever order its keys came in. */
function factsKey(facts: readonly VerifiedFact[]): string {
  return JSON.stringify(facts.map((fact) => [fact.checked, 'issuer' in fact ? fact.issuer : null, fact.value]));
}

/**
 * A ship's facts as discovery shows them (decision 0059): every writer's,
 * oldest first, each with its writer, a ship by the name it has now, and
 * when it was written.
 */
export function discoveredVerifiedOf(written: readonly WrittenFacts[], shipNames: ReadonlyMap<ShipId, string>): DiscoveredVerifiedFact[] {
  return written
    .toSorted((first, second) => first.at.getTime() - second.at.getTime())
    .flatMap(({ writer, facts, at }) => facts.map((fact) => ({ ...fact, by: discoveredWriterOf(writer, shipNames), at: at.toISOString() })));
}

function discoveredWriterOf(writer: FactWriter, shipNames: ReadonlyMap<ShipId, string>): DiscoveredVerifiedFact['by'] {
  switch (writer.kind) {
    case 'ship':
      return { kind: 'ship', id: writer.shipId, name: shipNames.get(writer.shipId) ?? writer.shipId };
    case 'account':
      return { kind: 'account', id: writer.accountId };
    case 'installation':
      return { kind: 'installation' };
  }
}
