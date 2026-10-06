import {
  FLEET_SCOPES,
  SCOPES,
  type FleetId,
  type FleetScope,
  type LeaseId,
  type Scope,
  type ShipId,
  type ShipKind,
  type ShipStatus,
} from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor, type Actor, type NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { Recipient } from '../shared/selector.js';
import { refuseEndedLease, type Lease, type LeaseEnded, type Location } from './lease.js';
import { shipName, shipType } from './ship-handle.js';
import { shipNote } from './ship-note.js';

/** A durable, addressable identity with an inbox. Outlives any session. */
export interface Ship {
  id: ShipId;
  fleetId: FleetId;
  name: string;
  type: string;
  kind: ShipKind;
  scopes: readonly Scope[];
  note: string | null;
  createdAt: Date;
  retiredAt: Date | null;
  /**
   * How an agent ship was commissioned: by which ship, under which of its
   * idempotency keys, and the hash of the request, so a repeat is known.
   * Null for the operator ship, which the fleet's initialisation creates.
   */
  commission: { by: ShipId; idempotencyKey: string; requestHash: string } | null;
}

/** The operator ship's name. Reserved: no other ship can take it. */
export const OPERATOR_SHIP_NAME = 'argo';

/** The operator ship's type label, the same word as its kind. */
export const OPERATOR_SHIP_TYPE = 'operator';

/** `argo`: the one ship of kind `operator`, holding every scope (ADR 0012). */
export function operatorShip(input: { id: ShipId; fleetId: FleetId; createdAt: Date }): Ship {
  return {
    ...input,
    name: OPERATOR_SHIP_NAME,
    type: OPERATOR_SHIP_TYPE,
    kind: 'operator',
    scopes: [...SCOPES],
    note: null,
    retiredAt: null,
    commission: null,
  };
}

/** The viewer ship's name, reserved as argo's is (decision 0022). */
export const VIEWER_SHIP_NAME = 'viewer';

/** The viewer ship's type label, the same word as its kind. */
export const VIEWER_SHIP_TYPE = 'viewer';

/**
 * The viewer ship: the fleet's read-only door into the console (decision
 * 0022). It reads the fleet and nothing more, has no secret, and holds no
 * lease: many people view through it at once, each with a console session.
 */
export function viewerShip(input: { id: ShipId; fleetId: FleetId; createdAt: Date }): Ship {
  return {
    ...input,
    name: VIEWER_SHIP_NAME,
    type: VIEWER_SHIP_TYPE,
    kind: 'viewer',
    scopes: ['fleet:read'],
    note: null,
    retiredAt: null,
    commission: null,
  };
}

/** The ships no session crews with a secret and no fleet action ends or renames, by kind, as their refusals name them. */
const PERMANENT_SHIPS: Partial<Record<ShipKind, string>> = { operator: 'the operator ship', viewer: 'the viewer ship' };

/** The scopes every agent ship gets at creation: it sends and receives; commissioning may add fleet scopes (ADR 0002). */
export const AGENT_SCOPES: readonly Scope[] = ['messages:send', 'messages:receive'];

export type CommissionRefusal = DomainError<
  'INVALID_SHIP_NAME' | 'SHIP_NAME_RESERVED' | 'INVALID_SHIP_TYPE' | 'INVALID_SHIP_NOTE' | 'SHIP_NAME_TAKEN'
>;

/**
 * A new agent ship, awaiting crew, and its ShipCommissioned event. The name is
 * a handle, never `argo`, and unique among the fleet's active ships:
 * `activeShipNamed` is the active ship that already holds it, if any, read
 * while the name is locked.
 */
export function commissionAgentShip(
  input: {
    id: ShipId;
    fleetId: FleetId;
    name: string;
    type: string;
    note?: string;
    /** fleet:read, fleet:manage and/or fleet:crew, added to the agent scopes (ADR 0002). */
    fleetScopes?: readonly FleetScope[];
    at: Date;
    actor: Actor;
    commission: { by: ShipId; idempotencyKey: string; requestHash: string };
  },
  fleet: { activeShipNamed: Ship | undefined },
): Result<{ ship: Ship; events: NewEvent[] }, CommissionRefusal> {
  const name = shipName(input.name);
  if (!name.isOk) {
    return name;
  }
  const notReserved = checkNameIsNotReserved(name.value);
  if (!notReserved.isOk) {
    return notReserved;
  }
  const type = shipType(input.type);
  if (!type.isOk) {
    return type;
  }
  const note = shipNote(input.note);
  if (!note.isOk) {
    return note;
  }
  if (fleet.activeShipNamed) {
    return refuse('SHIP_NAME_TAKEN', `An active ship is already named ${name.value}`);
  }

  const { id, fleetId, at, actor } = input;
  const ship: Ship = {
    id,
    fleetId,
    name: name.value,
    type: type.value,
    kind: 'agent',
    scopes: [...AGENT_SCOPES, ...FLEET_SCOPES.filter((scope) => input.fleetScopes?.includes(scope))],
    note: note.value,
    createdAt: at,
    retiredAt: null,
    commission: input.commission,
  };
  return ok({
    ship,
    events: [
      {
        fleetId,
        type: 'ShipCommissioned',
        occurredAt: at,
        actor,
        shipId: id,
        details: { name: ship.name, type: ship.type, kind: ship.kind, scopes: ship.scopes.join(' ') },
      },
    ],
  });
}

/**
 * Awaiting crew, crewed or retired: derived from whether a session holds the
 * ship's lease and whether the ship is retired, never set by hand.
 */
export function shipStatus(ship: Ship, lease: { isCrewed: boolean }): ShipStatus {
  if (ship.retiredAt !== null) {
    return 'retired';
  }
  // argo and the viewer ship are the console's own: argo's crew is the console, signed in or not
  // (decision 0012), and the viewer ship is a door into it, always open (decision 0022).
  return lease.isCrewed || ship.kind !== 'agent' ? 'crewed' : 'awaitingCrew';
}

const STATUS_WORDS: Record<ShipStatus, string> = {
  awaitingCrew: 'awaiting crew',
  crewed: 'crewed',
  retired: 'retired',
};

/**
 * A starting prompt is issued only while the ship awaits crew. Never for `argo`:
 * it has no secret, and only the operator's console sign-in crews it (ADR 0012).
 */
export function checkCanIssueStartingPrompt(
  ship: Ship,
  lease: { isCrewed: boolean },
): Result<void, DomainError<'OPERATOR_SHIP_GETS_NO_STARTING_PROMPT' | 'SHIP_NOT_AWAITING_CREW'>> {
  if (ship.kind !== 'agent') {
    return refuse(
      'OPERATOR_SHIP_GETS_NO_STARTING_PROMPT',
      `${ship.name} has no secret: only the operator's console sign-in crews it, so it gets no starting prompt`,
    );
  }
  const status = shipStatus(ship, lease);
  return status === 'awaitingCrew'
    ? ok(undefined)
    : refuse(
        'SHIP_NOT_AWAITING_CREW',
        `${ship.name} is ${STATUS_WORDS[status]}: a starting prompt is issued only while a ship awaits crew`,
      );
}

export type PingRefusal = DomainError<'OPERATOR_SHIP_IS_NOT_PINGED' | 'SHIP_ALREADY_RETIRED' | 'SHIP_NOT_CREWED'>;

/**
 * A ping goes only to a crewed ship: a session must be there to answer it.
 * Never to `argo`: the console is no session that answers with pong.
 */
export function checkCanBePinged(ship: Ship, lease: { isCrewed: boolean }): Result<void, PingRefusal> {
  if (ship.kind === 'operator') {
    return refuse('OPERATOR_SHIP_IS_NOT_PINGED', `${ship.name} is the console: only a ship a session crews is pinged`);
  }
  if (ship.kind === 'viewer') {
    return refuse('OPERATOR_SHIP_IS_NOT_PINGED', `${ship.name} is the viewer ship: only a ship a session crews is pinged`);
  }
  switch (shipStatus(ship, lease)) {
    case 'crewed':
      return ok(undefined);
    case 'retired':
      return refuse('SHIP_ALREADY_RETIRED', `${ship.name} is retired: only a ship a session crews is pinged`);
    case 'awaitingCrew':
      return refuse('SHIP_NOT_CREWED', `${ship.name} is awaiting crew: no session would answer a ping`);
  }
}

export type ClaimRefusal = DomainError<'OPERATOR_SHIP_HAS_NO_SECRET' | 'SHIP_NOT_AWAITING_CREW'>;

/**
 * A session claims the ship with its secret (`register`): a new lease at the
 * location the session reports, holding the hash of its crew token, and
 * ShipClaimed, caused by the ship itself. Only while the ship awaits crew: a
 * second claim fails while a lease is held, and the operator frees the ship
 * with Release (ADR 0010); a retired ship is never claimed again. Never
 * `argo`: it has no secret, and only the operator's console sign-in crews it
 * (ADR 0012).
 */
export function claimShip(
  crew: { ship: Ship; heldLease: Lease | undefined },
  claim: { leaseId: LeaseId; location: Location; harness: string; crewTokenHash: string; at: Date },
): Result<{ lease: Lease; events: NewEvent[] }, ClaimRefusal> {
  const { ship, heldLease } = crew;
  if (ship.kind === 'operator') {
    return refuse('OPERATOR_SHIP_HAS_NO_SECRET', `${ship.name} has no secret: only the operator's console sign-in crews it`);
  }
  if (ship.kind === 'viewer') {
    return refuse('OPERATOR_SHIP_HAS_NO_SECRET', `${ship.name} has no secret: it is viewed through console sessions the installation hands out`);
  }
  const status = shipStatus(ship, { isCrewed: heldLease !== undefined });
  if (status !== 'awaitingCrew') {
    return refuse(
      'SHIP_NOT_AWAITING_CREW',
      `${ship.name} is ${STATUS_WORDS[status]}: a session claims a ship only while it awaits crew`,
    );
  }

  const { leaseId, location, crewTokenHash, at } = claim;
  const lease: Lease = {
    id: leaseId,
    fleetId: ship.fleetId,
    shipId: ship.id,
    location,
    harness: claim.harness,
    crewTokenHash,
    startedAt: at,
    endedAt: null,
  };
  return ok({
    lease,
    events: [
      {
        fleetId: ship.fleetId,
        type: 'ShipClaimed',
        occurredAt: at,
        actor: shipActor(ship.id),
        shipId: ship.id,
        details: { leaseId, location: location.kind, locationDescription: location.description, harness: claim.harness },
      },
    ],
  });
}

/**
 * A message can be addressed to any ship of the fleet, `argo` included, as long
 * as it is not retired: a retired ship's id can never be addressed again, so a
 * message to it could never be delivered. Never the viewer ship, which
 * receives nothing (decision 0022).
 */
export function addressShip(ship: Ship): Result<Recipient, DomainError<'UNRESOLVABLE_SELECTOR'>> {
  if (ship.kind === 'viewer') {
    return refuse('UNRESOLVABLE_SELECTOR', `${ship.name} is the viewer ship: it receives nothing, so nothing is sent to it`);
  }
  return ship.retiredAt === null
    ? ok({ kind: 'ship', shipId: ship.id })
    : refuse('UNRESOLVABLE_SELECTOR', `${ship.name} is retired: a retired ship is never addressed again`);
}

/** The reserved names, each with the ship it is kept for. */
const RESERVED_NAMES: ReadonlyMap<string, string> = new Map([
  [OPERATOR_SHIP_NAME, 'the operator ship'],
  [VIEWER_SHIP_NAME, 'the viewer ship'],
]);

export function isReservedShipName(name: string): boolean {
  return RESERVED_NAMES.has(name);
}

type Permanent = DomainError<'OPERATOR_SHIP_IS_PERMANENT'>;
type Reserved = DomainError<'SHIP_NAME_RESERVED'>;

/** Commissioning and renaming call this: no ship but the operator ship may be called `argo`. */
export function checkNameIsNotReserved(name: string): Result<void, Reserved> {
  const keptFor = RESERVED_NAMES.get(name);
  return keptFor === undefined ? ok(undefined) : refuse('SHIP_NAME_RESERVED', `The name ${name} is reserved for ${keptFor}`);
}

export type ReleaseRefusal = Permanent | DomainError<'SHIP_NOT_CREWED'>;

export type RetireRefusal = Permanent | DomainError<'SHIP_ALREADY_RETIRED'>;

/**
 * The operator ends a ship for good (Retire): any ship but argo, crewed or
 * not, unless it is retired already.
 */
export function checkCanRetire(ship: Ship): Result<void, RetireRefusal> {
  const permanent = checkNotOperatorShip(ship, 'retired');
  if (!permanent.isOk) {
    return permanent;
  }
  return ship.retiredAt === null
    ? ok(undefined)
    : refuse('SHIP_ALREADY_RETIRED', `${ship.name} is retired already: a retired ship stays retired`);
}

/**
 * The operator frees a ship from the session crewing it (Release), and the
 * ship awaits a new crew: `heldLease` is its open lease, if any, read while
 * locked. Only a crewed ship is released, never argo (ADR 0012). A ship
 * awaiting crew has no session to free: an unclaimed prompt is replaced with
 * a new prompt instead. Returns the lease to end.
 */
export function checkCanRelease(ship: Ship, heldLease: Lease | undefined): Result<Lease, ReleaseRefusal> {
  const permanent = checkNotOperatorShip(ship, 'released');
  if (!permanent.isOk) {
    return permanent;
  }
  const status = shipStatus(ship, { isCrewed: heldLease !== undefined });
  if (heldLease === undefined || status !== 'crewed') {
    const instead = status === 'awaitingCrew' ? '. A new starting prompt replaces an unclaimed one' : '';
    return refuse('SHIP_NOT_CREWED', `${ship.name} is ${STATUS_WORDS[status]}: only a crewed ship is released${instead}`);
  }
  return ok(heldLease);
}

/**
 * The session crewing a ship ends its own lease (`deregister`), and the ship
 * awaits a new crew: `heldLease` is the ship's open lease, if any, read while
 * locked. Only while it is the crew's own lease: once that lease has ended,
 * released or deregistered, the crew has nothing left to end, and a new
 * crew's lease is never its to end. Never argo, which is never released
 * (ADR 0012). Returns the lease to end.
 */
export function checkCanDeregister(
  ship: Ship,
  crew: { leaseId: LeaseId; heldLease: Lease | undefined },
): Result<Lease, Permanent | LeaseEnded> {
  const permanent = checkNotOperatorShip(ship, 'released');
  if (!permanent.isOk) {
    return permanent;
  }
  const { leaseId, heldLease } = crew;
  return heldLease?.id === leaseId ? ok(heldLease) : refuseEndedLease();
}

export function checkCanRename(ship: Ship, newName: string): Result<void, Permanent | Reserved> {
  const permanent = checkNotOperatorShip(ship, 'renamed');
  return permanent.isOk ? checkNameIsNotReserved(newName) : permanent;
}

export type RenameRefusal =
  | Permanent
  | Reserved
  | DomainError<'INVALID_SHIP_NAME' | 'SHIP_NAME_TAKEN' | 'SHIP_ALREADY_RETIRED'>;

/**
 * The operator gives a ship a new name (docs/blueprint.md, "Ship"): any ship
 * but argo, crewed or not, never a retired one, which keeps the name it had.
 * The name is a handle, never `argo`, and unique among the fleet's active
 * ships: `activeShipNamed` is the active ship that holds it, if any, read
 * while the name is locked. Messages store ids, so nothing sent is
 * redirected; a sender addressing the old name no longer reaches it. The
 * name it already has is OK, and nothing changes.
 */
export function renameShip(
  ship: Ship,
  rename: { name: string; at: Date; actor: Actor; activeShipNamed: Ship | undefined },
): Result<{ ship: Ship; events: NewEvent[] }, RenameRefusal> {
  const name = shipName(rename.name);
  if (!name.isOk) {
    return name;
  }
  const allowed = checkCanRename(ship, name.value);
  if (!allowed.isOk) {
    return allowed;
  }
  if (ship.retiredAt !== null) {
    return refuse('SHIP_ALREADY_RETIRED', `${ship.name} is retired: a retired ship keeps the name it had`);
  }
  if (name.value === ship.name) {
    return ok({ ship, events: [] });
  }
  if (rename.activeShipNamed && rename.activeShipNamed.id !== ship.id) {
    return refuse('SHIP_NAME_TAKEN', `An active ship is already named ${name.value}`);
  }
  return ok({
    ship: { ...ship, name: name.value },
    events: [
      {
        fleetId: ship.fleetId,
        type: 'ShipRenamed',
        occurredAt: rename.at,
        actor: rename.actor,
        shipId: ship.id,
        details: { from: ship.name, to: name.value },
      },
    ],
  });
}

export type CrewRequestShipRefusal = Permanent | DomainError<'SHIP_ALREADY_RETIRED'>;

/** A crew request asks that a ship be kept crewed: any ship a session can crew, never argo, the viewer ship or a retired ship. */
export function checkCanBeRequestedCrew(ship: Ship): Result<void, CrewRequestShipRefusal> {
  const permanent = checkNotOperatorShip(ship, 'crewed by request');
  if (!permanent.isOk) {
    return permanent;
  }
  return ship.retiredAt === null
    ? ok(undefined)
    : refuse('SHIP_ALREADY_RETIRED', `${ship.name} is retired: no session crews it again`);
}

/** argo and the viewer ship are permanent: no fleet action retires, releases or renames them (ADR 0012, decision 0022). */
function checkNotOperatorShip(ship: Ship, action: 'retired' | 'released' | 'renamed' | 'crewed by request'): Result<void, Permanent> {
  const permanent = PERMANENT_SHIPS[ship.kind];
  return permanent === undefined ? ok(undefined) : refuse('OPERATOR_SHIP_IS_PERMANENT', `${ship.name} is ${permanent} and can never be ${action}`);
}
