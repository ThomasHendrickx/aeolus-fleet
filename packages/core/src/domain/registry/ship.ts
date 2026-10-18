import {
  type CommissionedShipKind,
  SCOPES,
  type FleetId,
  type LeaseId,
  type Scope,
  type ScopeName,
  type ShipId,
  type ShipKind,
  type ShipStatus,
} from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor, type Actor, type NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { Recipient } from '../shared/selector.js';
import { refuseEndedLease, type Lease, type LeaseEnded, type Location } from './lease.js';
import { mayGrant } from './scope-grant.js';
import type { ScopeNamespace } from './scope-namespace.js';
import { shipName, shipType } from './ship-handle.js';
import { shipNote } from './ship-note.js';

/** A durable, addressable identity with an inbox. Outlives any session. */
export interface Ship {
  id: ShipId;
  fleetId: FleetId;
  name: string;
  type: string;
  kind: ShipKind;
  /** Core scopes and plugin scopes (decision 0046). */
  scopes: readonly ScopeName[];
  note: string | null;
  createdAt: Date;
  retiredAt: Date | null;
  /**
   * How an agent ship was commissioned: by which ship, under which of its
   * idempotency keys, and the hash of the request, so a repeat is known.
   * Null for the operator ship, which the fleet's initialisation creates.
   */
  commission: { by: ShipId; idempotencyKey: string; requestHash: string } | null;
  /** The ship that answers for it, a person's ship or argo (decision 0045); null for argo and the viewer. */
  owner: ShipId | null;
}

/**
 * How a ship got its owner at commission: its commissioner's owner, argo when
 * the commissioner has none, the owner of the ship that asked a plugin's
 * ship for it, which the plugin named, or for an app ship the owner argo
 * picked, which the gateway named (decision 0045).
 */
export type OwnerSetHow = 'inherited' | 'argoByDefault' | 'askingShipOwner' | 'named';

/** OwnerSet's details: the owner and how it was set, with the asking ship when a plugin named its owner. */
export type OwnerSet =
  | { ownerShipId: ShipId; how: 'inherited' | 'argoByDefault' | 'named' }
  | { ownerShipId: ShipId; how: 'askingShipOwner'; askingShipId: ShipId };

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
    owner: null,
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
    owner: null,
  };
}

/** The ships no session crews with a secret and no fleet action ends or renames, by kind, as their refusals name them. */
const PERMANENT_SHIPS: Partial<Record<ShipKind, string>> = { operator: 'the operator ship', viewer: 'the viewer ship' };

/**
 * Whether the ship is the console's own, argo or the viewer: always crewed,
 * with no secret. Every other kind is crewed through its lease (decision 0044).
 */
export function isConsoleShip(ship: Pick<Ship, 'kind'>): boolean {
  return PERMANENT_SHIPS[ship.kind] !== undefined;
}

/** The scopes every agent ship gets at creation: it sends and receives; commissioning may add fleet scopes (ADR 0002). */
export const AGENT_SCOPES: readonly Scope[] = ['messages:send', 'messages:receive'];

/** Whether the scope is one of core's, not a plugin's. */
function isCoreScope(scope: string): boolean {
  return SCOPES.some((core) => core === scope);
}

export type CommissionRefusal = DomainError<
  | 'INVALID_SHIP_NAME'
  | 'SHIP_NAME_RESERVED'
  | 'INVALID_SHIP_TYPE'
  | 'INVALID_SHIP_NOTE'
  | 'SHIP_NAME_TAKEN'
  | 'KIND_COMMISSIONED_BY_ARGO_ONLY'
  | 'INVALID_SCOPE'
  | 'SCOPE_NOT_DECLARED'
  | 'SCOPE_NOT_HELD'
  | 'PLUGIN_SCOPE_NOT_YOURS'
  | 'INVALID_OWNER'
>;

/**
 * A new ship, awaiting crew, and its ShipCommissioned event. An agent unless
 * the commission states another kind; only argo commissions a person or app
 * ship, to be true to what the ship is (decision 0044). The name is a handle,
 * never `argo`, and unique among the fleet's active ships: `activeShipNamed`
 * is the active ship that already holds it, if any, read while the name is
 * locked. It gets the scopes every ship has and those asked for that the
 * commissioner may grant (decision 0046): core scopes in their fixed order,
 * then plugin scopes in name order, each once. Its owner is the
 * commissioner's owner, argo by default; a commissioner holding
 * fleet:on-behalf, a plugin's ship, may name instead the ship that asked it,
 * whose owner it gets (decision 0045).
 */
export function commissionShip(
  input: {
    id: ShipId;
    fleetId: FleetId;
    name: string;
    type: string;
    kind?: CommissionedShipKind;
    /** The ship that commissions it, and the fleet's argo: the new ship's owner is the commissioner's owner, argo by default (decision 0045). */
    commissioner: Ship;
    argoShipId: ShipId;
    /** The ship that asked a plugin's ship for this one, whose owner the new ship gets (decision 0045). */
    askingShip?: Ship;
    /** The id of the owner argo picked for an app ship, as the gateway named it, and that ship as the fleet holds it, if it does (decision 0045). */
    owner?: ShipId;
    namedOwner?: Ship;
    note?: string;
    /** Scopes added to the agent scopes (decision 0046). */
    scopes?: readonly string[];
    at: Date;
    actor: Actor;
    commission: { by: ShipId; idempotencyKey: string; requestHash: string };
  },
  fleet: {
    activeShipNamed: Ship | undefined;
    /** The plugin namespaces the scopes name, with their declarers' names, by namespace. */
    namespaces: ReadonlyMap<string, { namespace: ScopeNamespace; declarerName: string }>;
  },
): Result<{ ship: Ship; events: NewEvent[] }, CommissionRefusal> {
  const { kind = 'agent' } = input;
  const isOnBehalf = input.commissioner.scopes.includes('fleet:on-behalf');
  if (kind !== 'agent' && input.commissioner.kind !== 'operator' && !(kind === 'app' && isOnBehalf)) {
    return refuse(
      'KIND_COMMISSIONED_BY_ARGO_ONLY',
      kind === 'app'
        ? 'Only argo, or a ship holding fleet:on-behalf such as the gateway, commissions an app ship: commission an agent ship instead'
        : `Only argo commissions a ${kind} ship: commission an agent ship instead`,
    );
  }
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
  const asked = input.scopes ?? [];
  const granter = { shipId: input.commissioner.id, kind: input.commissioner.kind, scopes: input.commissioner.scopes };
  for (const scope of asked) {
    const allowed = mayGrant(scope, { granter, namespaces: fleet.namespaces });
    if (!allowed.isOk) {
      return allowed;
    }
  }

  if (input.askingShip !== undefined && !isOnBehalf) {
    return refuse('SCOPE_NOT_HELD', 'Naming the ship that asked for this one needs the fleet:on-behalf scope: commission without ownerOf');
  }
  if (input.owner !== undefined) {
    const named = checkNamedOwner({ kind, isOnBehalf, askingShip: input.askingShip, namedOwner: input.namedOwner });
    if (!named.isOk) {
      return named;
    }
  }

  const { id, fleetId, at, actor } = input;
  const owner = ownerAtCommission(input);
  const ship: Ship = {
    id,
    fleetId,
    name: name.value,
    type: type.value,
    kind,
    scopes: [...SCOPES.filter((scope) => AGENT_SCOPES.includes(scope) || asked.includes(scope)), ...[...new Set(asked.filter((scope) => !isCoreScope(scope)))].toSorted()],
    note: note.value,
    createdAt: at,
    retiredAt: null,
    commission: input.commission,
    owner: owner.ownerShipId,
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
      { fleetId, type: 'OwnerSet', occurredAt: at, actor, shipId: id, details: owner },
    ],
  });
}

/** Why a ship's owner changed: argo set it, or its owner's ship retired and it fell to argo. */
export type OwnerChangedWhy = 'setByArgo' | 'ownerRetired';

export type ChangeOwnerRefusal = DomainError<'SHIP_HAS_NO_OWNER' | 'SHIP_ALREADY_RETIRED' | 'INVALID_OWNER'>;

/**
 * The ship with its new owner and OwnerChanged (decision 0045). The owner is
 * an active person's ship or argo; argo and the viewer have none, and a
 * retired ship keeps the owner it had. The same owner again changes nothing
 * and writes no event.
 */
export function changeOwner(
  ship: Ship,
  change: { owner: Ship | undefined; why: OwnerChangedWhy; at: Date; actor: Actor },
): Result<{ ship: Ship; events: NewEvent[] }, ChangeOwnerRefusal> {
  const { owner } = change;
  if (isConsoleShip(ship)) {
    return refuse('SHIP_HAS_NO_OWNER', `${ship.name} is the console's own ship: it has no owner`);
  }
  if (ship.retiredAt !== null) {
    return refuse('SHIP_ALREADY_RETIRED', `${ship.name} is retired: it keeps the owner it had`);
  }
  if (owner?.retiredAt !== null || (owner.kind !== 'person' && owner.kind !== 'operator')) {
    return refuse('INVALID_OWNER', "An owner is an active person's ship or argo");
  }
  if (ship.owner === owner.id) {
    return ok({ ship, events: [] });
  }
  return ok({
    ship: { ...ship, owner: owner.id },
    events: [
      {
        fleetId: ship.fleetId,
        type: 'OwnerChanged',
        occurredAt: change.at,
        actor: change.actor,
        shipId: ship.id,
        details: { fromShipId: ship.owner, toShipId: owner.id, why: change.why },
      },
    ],
  });
}

/**
 * The owner argo picked, named at commission: only for an app ship, only by a
 * ship holding fleet:on-behalf, never beside an asking ship, and an active
 * person's ship or argo, as any owner is (decision 0045).
 */
function checkNamedOwner(named: {
  kind: CommissionedShipKind;
  isOnBehalf: boolean;
  askingShip: Ship | undefined;
  namedOwner: Ship | undefined;
}): Result<undefined, DomainError<'SCOPE_NOT_HELD' | 'INVALID_OWNER'>> {
  if (!named.isOnBehalf) {
    return refuse('SCOPE_NOT_HELD', 'Naming the owner of a new ship needs the fleet:on-behalf scope: commission without owner');
  }
  if (named.kind !== 'app') {
    return refuse('INVALID_OWNER', "Only an app ship gets the owner argo picked at commission: commission without owner, and argo sets an owner later");
  }
  if (named.askingShip !== undefined) {
    return refuse('INVALID_OWNER', 'Name the owner or the ship that asked, not both');
  }
  const { namedOwner } = named;
  if (namedOwner?.retiredAt !== null || (namedOwner.kind !== 'person' && namedOwner.kind !== 'operator')) {
    return refuse('INVALID_OWNER', "An owner is an active person's ship or argo");
  }
  return ok(undefined);
}

/**
 * The asking ship's owner, when a plugin's ship named it; else the
 * commissioner's owner, inherited. argo for a ship that has none, as argo
 * itself has none.
 */
function ownerAtCommission(input: { commissioner: Ship; askingShip?: Ship; namedOwner?: Ship; argoShipId: ShipId }): OwnerSet {
  const { commissioner, askingShip, namedOwner, argoShipId } = input;
  if (namedOwner !== undefined) {
    return { ownerShipId: namedOwner.id, how: 'named' };
  }
  if (askingShip !== undefined) {
    return { ownerShipId: askingShip.owner ?? argoShipId, how: 'askingShipOwner', askingShipId: askingShip.id };
  }
  return commissioner.owner === null ? { ownerShipId: argoShipId, how: 'argoByDefault' } : { ownerShipId: commissioner.owner, how: 'inherited' };
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
  return lease.isCrewed || isConsoleShip(ship) ? 'crewed' : 'awaitingCrew';
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
  if (isConsoleShip(ship)) {
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
