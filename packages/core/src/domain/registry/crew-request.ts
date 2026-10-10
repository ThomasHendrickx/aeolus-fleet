import {
  CREW_REQUEST_REASON_MAX_LENGTH,
  CREW_REQUEST_SETTINGS_MAX_BYTES,
  isOneLine,
  crewRequestSettingsBytes,
  type CrewStatus,
  type FleetId,
  type Scope,
  type ShipId,
} from '@aeolus-fleet/common';

import { hasScope, type Caller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { JsonObject } from './report-details.js';
import { checkCanBeRequestedCrew, type CrewRequestShipRefusal, type Ship } from './ship.js';

/**
 * A standing request that a ship be kept crewed (docs/blueprint.md, "Crew
 * request"; decision 0029): at most one per ship, in three parts with one
 * writer each. The settings, which the server stores without meaning, by a
 * requester with fleet:manage; the assignment, the trierarch ship that crews
 * it, by a ship with crew:assign; the status, by the assigned trierarch.
 * Removing an assigned request marks it releasing; it goes once its
 * trierarch confirms.
 */
export interface CrewRequest {
  fleetId: FleetId;
  shipId: ShipId;
  settings: JsonObject;
  /** One on the first request, one more on every request after it. */
  settingsVersion: number;
  /** When the settings were last requested. */
  requestedAt: Date;
  /** The trierarch ship it is assigned to; null while unassigned. */
  assignedTo: ShipId | null;
  /** How its trierarch says the crew stands; null until it says. */
  status: CrewStatus | null;
  /** Why no trierarch can take it, written by the assigner while unassigned; null when none. */
  reason: string | null;
  /** How many times its trierarch restarted the session within its restart window, written with the status: 0 on its first start (#332). */
  attempt: number;
  /** When the session its trierarch runs now started, written with the status; null while none runs. */
  sessionStartedAt: Date | null;
  /** Whether its crew is final: set by its trierarch's first running, restarting or crashed, and kept whatever status follows (#382, #472). */
  isFinal: boolean;
  /** The trierarchs that gave it back before their crew was final, oldest first (#382); cleared on every new settings version. */
  givenBack: GiveBack[];
}

/** A trierarch that gave the request back, the settings version it tried, why, and when. */
export interface GiveBack {
  trierarchShipId: ShipId;
  settingsVersion: number;
  reason: string;
  givenBackAt: Date;
}

/** The statuses of a crew that is final (#382): its trierarch saw it working, so the request is no longer given back. */
const FINAL_STATUSES: ReadonlySet<CrewStatus> = new Set(['running', 'restarting', 'crashed']);

type NotFound = DomainError<'CREW_REQUEST_NOT_FOUND'>;
type Releasing = DomainError<'CREW_REQUEST_RELEASING'>;
type NotTheCallers = DomainError<'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER'>;

export type RequestCrewRefusal = CrewRequestShipRefusal | Releasing | DomainError<'CREW_REQUEST_SETTINGS_TOO_LARGE'>;

function notFound(ship: Ship): Result<never, NotFound> {
  return refuse('CREW_REQUEST_NOT_FOUND', `${ship.name} has no crew request`);
}

function event(ship: Ship, change: Pick<NewEvent, 'type' | 'details'> & { at: Date; actor: Actor }): NewEvent {
  const { at, actor, ...what } = change;
  return { fleetId: ship.fleetId, occurredAt: at, actor, shipId: ship.id, ...what };
}

/**
 * A requester asks that the ship be kept crewed, with these settings: the
 * request it holds now, replacing the settings of any it held and keeping its
 * assignment and status, and CrewRequested with the settings version, never
 * the settings. Never argo, the viewer ship or a retired ship; settings of at
 * most 16 KB; never while the request is releasing.
 */
export function requestCrew(
  { ship, current }: { ship: Ship; current: CrewRequest | undefined },
  input: { settings: JsonObject; at: Date; actor: Actor },
): Result<{ request: CrewRequest; events: NewEvent[] }, RequestCrewRefusal> {
  const requestable = checkCanBeRequestedCrew(ship);
  if (!requestable.isOk) {
    return requestable;
  }
  if (current?.status === 'releasing') {
    return refuse('CREW_REQUEST_RELEASING', `${ship.name}'s crew request is releasing: request again once its trierarch confirms`);
  }
  const bytes = crewRequestSettingsBytes(input.settings);
  if (bytes > CREW_REQUEST_SETTINGS_MAX_BYTES) {
    return refuse(
      'CREW_REQUEST_SETTINGS_TOO_LARGE',
      `settings is ${String(bytes)} bytes, the limit is ${String(CREW_REQUEST_SETTINGS_MAX_BYTES)} (decision 0029)`,
    );
  }
  const request: CrewRequest = {
    fleetId: ship.fleetId,
    shipId: ship.id,
    settings: input.settings,
    settingsVersion: (current?.settingsVersion ?? 0) + 1,
    requestedAt: input.at,
    assignedTo: current?.assignedTo ?? null,
    status: current?.status ?? null,
    reason: current?.reason ?? null,
    attempt: current?.attempt ?? 0,
    sessionStartedAt: current?.sessionStartedAt ?? null,
    isFinal: current?.isFinal ?? false,
    // New settings may fit the trierarchs that gave the old ones back.
    givenBack: [],
  };
  return ok({ request, events: [event(ship, { at: input.at, actor: input.actor, type: 'CrewRequested', details: { settingsVersion: request.settingsVersion } })] });
}

/**
 * A requester removes the ship's crew request. Unassigned, it goes at once,
 * with CrewRequestRemoved. Assigned, it is marked releasing, with
 * CrewStatusChanged, and goes once its trierarch confirms; removing it again
 * meanwhile changes nothing.
 */
export function removeCrewRequest(
  { ship, current }: { ship: Ship; current: CrewRequest | undefined },
  input: { at: Date; actor: Actor },
): Result<{ request: CrewRequest | undefined; events: NewEvent[] }, NotFound> {
  if (!current) {
    return notFound(ship);
  }
  if (current.assignedTo === null) {
    return ok({ request: undefined, events: [event(ship, { ...input, type: 'CrewRequestRemoved' })] });
  }
  if (current.status === 'releasing') {
    return ok({ request: current, events: [] });
  }
  return ok({
    request: { ...current, status: 'releasing' },
    events: [event(ship, { ...input, type: 'CrewStatusChanged', details: { status: 'releasing' } })],
  });
}

export type AssignCrewRefusal =
  | NotFound
  | DomainError<'CREW_REQUEST_ALREADY_ASSIGNED' | 'SHIP_NOT_AWAITING_CREW' | 'ASSIGNEE_NOT_ACTIVE'>;

/**
 * A ship with crew:assign assigns the request to a trierarch, by optimistic
 * claim: only while it is unassigned, so of two claims the first wins. Never
 * a crewed ship (crewing by hand fulfils the request). Any active ship of the
 * fleet may be the assignee: the fleet does no routing, and a ship that is no
 * trierarch just gets work it does not understand. CrewAssigned names it.
 */
export function assignCrew(
  { ship, current, isCrewed, assignee }: { ship: Ship; current: CrewRequest | undefined; isCrewed: boolean; assignee: Ship | undefined },
  input: { at: Date; actor: Actor },
): Result<{ request: CrewRequest; events: NewEvent[] }, AssignCrewRefusal> {
  if (!current) {
    return notFound(ship);
  }
  if (current.assignedTo !== null) {
    return refuse('CREW_REQUEST_ALREADY_ASSIGNED', `${ship.name}'s crew request is assigned already`);
  }
  if (isCrewed) {
    return refuse('SHIP_NOT_AWAITING_CREW', `${ship.name} is crewed: crewing it by hand fulfils its request`);
  }
  if (assignee?.retiredAt !== null) {
    return refuse('ASSIGNEE_NOT_ACTIVE', 'A crew request is assigned only to an active ship of the fleet');
  }
  return ok({
    request: { ...current, assignedTo: assignee.id, reason: null },
    events: [event(ship, { ...input, type: 'CrewAssigned', details: { assignedTo: assignee.id } })],
  });
}

export type ExplainCrewRequestRefusal = NotFound | DomainError<'CREW_REQUEST_ALREADY_ASSIGNED' | 'INVALID_CREW_REQUEST_REASON'>;

/**
 * The assigner writes why no trierarch can take an unassigned request, one
 * line, trimmed; none clears it. CrewRequestExplained when it changes; an
 * assignment clears it.
 */
export function explainCrewRequest(
  { ship, current }: { ship: Ship; current: CrewRequest | undefined },
  input: { reason: string | null; at: Date; actor: Actor },
): Result<{ request: CrewRequest; events: NewEvent[] }, ExplainCrewRequestRefusal> {
  if (!current) {
    return notFound(ship);
  }
  if (current.assignedTo !== null) {
    return refuse('CREW_REQUEST_ALREADY_ASSIGNED', `${ship.name}'s crew request is assigned: it needs no reason`);
  }
  const reason = input.reason?.trim() ?? '';
  if (reason.length > CREW_REQUEST_REASON_MAX_LENGTH || !isOneLine(reason)) {
    return refuse('INVALID_CREW_REQUEST_REASON', `A reason is one line of at most ${String(CREW_REQUEST_REASON_MAX_LENGTH)} characters`);
  }
  const kept = reason === '' ? null : reason;
  if (kept === current.reason) {
    return ok({ request: current, events: [] });
  }
  return ok({
    request: { ...current, reason: kept },
    events: [event(ship, { at: input.at, actor: input.actor, type: 'CrewRequestExplained', details: { reason: kept } })],
  });
}

/** Only the trierarch the request is assigned to writes its status or confirms its release. */
function checkAssignedTo({ ship, current, trierarchShipId }: { ship: Ship; current: CrewRequest; trierarchShipId: ShipId }): Result<void, NotTheCallers> {
  return current.assignedTo === trierarchShipId
    ? ok(undefined)
    : refuse('CREW_REQUEST_NOT_ASSIGNED_TO_CALLER', `${ship.name}'s crew request is not assigned to your ship`);
}

/**
 * The assigned trierarch writes how its crew of the ship stands, with the
 * restart attempt and when the session started (#332), and CrewStatusChanged
 * when any of them changes. Once the request is releasing, only releasing.
 * Its first running, restarting or crashed makes the crew final, and no later
 * status undoes it (#472).
 */
export function reportCrewStatus(
  { ship, current, trierarchShipId }: { ship: Ship; current: CrewRequest | undefined; trierarchShipId: ShipId },
  input: { status: CrewStatus; attempt: number; sessionStartedAt: Date | null; at: Date; actor: Actor },
): Result<{ request: CrewRequest; events: NewEvent[] }, NotFound | NotTheCallers | Releasing> {
  if (!current) {
    return notFound(ship);
  }
  const assigned = checkAssignedTo({ ship, current, trierarchShipId });
  if (!assigned.isOk) {
    return assigned;
  }
  if (current.status === 'releasing' && input.status !== 'releasing') {
    return refuse('CREW_REQUEST_RELEASING', `${ship.name}'s crew request is releasing: stop its session, end its lease and confirm`);
  }
  const isSameStart = (current.sessionStartedAt?.getTime() ?? null) === (input.sessionStartedAt?.getTime() ?? null);
  if (current.status === input.status && current.attempt === input.attempt && isSameStart) {
    return ok({ request: current, events: [] });
  }
  return ok({
    request: {
      ...current,
      status: input.status,
      attempt: input.attempt,
      sessionStartedAt: input.sessionStartedAt,
      isFinal: current.isFinal || FINAL_STATUSES.has(input.status),
    },
    events: [event(ship, { at: input.at, actor: input.actor, type: 'CrewStatusChanged', details: { status: input.status, attempt: input.attempt } })],
  });
}

/**
 * The assigned trierarch confirms it released the ship of a releasing
 * request: the request goes, with CrewRequestRemoved (the finalizer).
 */
export function confirmCrewRelease(
  { ship, current, trierarchShipId }: { ship: Ship; current: CrewRequest | undefined; trierarchShipId: ShipId },
  input: { at: Date; actor: Actor },
): Result<{ events: NewEvent[] }, NotFound | NotTheCallers | DomainError<'CREW_REQUEST_NOT_RELEASING'>> {
  if (!current) {
    return notFound(ship);
  }
  const assigned = checkAssignedTo({ ship, current, trierarchShipId });
  if (!assigned.isOk) {
    return assigned;
  }
  if (current.status !== 'releasing') {
    return refuse('CREW_REQUEST_NOT_RELEASING', `${ship.name}'s crew request is not releasing: nothing to confirm`);
  }
  return ok({ events: [event(ship, { ...input, type: 'CrewRequestRemoved' })] });
}

export type GiveBackCrewRequestRefusal =
  | NotFound
  | NotTheCallers
  | Releasing
  | DomainError<'CREW_REQUEST_FINAL' | 'CREW_REQUEST_SETTINGS_CHANGED' | 'INVALID_CREW_REQUEST_REASON'>;

/**
 * The assigned trierarch gives back a request it tried to fulfil and failed,
 * with a reason (#382): only while its crew is not final, never once its
 * trierarch reported it running, restarting or crashed, whatever it reported
 * since (#472), and only the settings version it tried. The request is unassigned
 * again, its status cleared, and the trierarch recorded, with
 * CrewRequestGivenBack, so placement leaves it out. A repeat by the same
 * trierarch for the same version, after a lost answer, is an OK with no
 * event. The use case ends the ship's lease with it.
 */
export function giveBackCrewRequest(
  { ship, current, trierarchShipId }: { ship: Ship; current: CrewRequest | undefined; trierarchShipId: ShipId },
  input: { settingsVersion: number; reason: string; at: Date; actor: Actor },
): Result<{ request: CrewRequest; events: NewEvent[] }, GiveBackCrewRequestRefusal> {
  if (!current) {
    return notFound(ship);
  }
  const isRepeat = current.givenBack.some((back) => back.trierarchShipId === trierarchShipId && back.settingsVersion === input.settingsVersion);
  if (isRepeat && current.assignedTo !== trierarchShipId) {
    return ok({ request: current, events: [] });
  }
  const assigned = checkAssignedTo({ ship, current, trierarchShipId });
  if (!assigned.isOk) {
    return assigned;
  }
  if (current.status === 'releasing') {
    return refuse('CREW_REQUEST_RELEASING', `${ship.name}'s crew request is releasing: stop its session, end its lease and confirm`);
  }
  if (current.isFinal) {
    return refuse('CREW_REQUEST_FINAL', `${ship.name}'s crew is final: a request is given back only before its crew works`);
  }
  if (input.settingsVersion !== current.settingsVersion) {
    return refuse(
      'CREW_REQUEST_SETTINGS_CHANGED',
      `${ship.name}'s crew request is at settings version ${String(current.settingsVersion)}, not ${String(input.settingsVersion)}: crew the new settings`,
    );
  }
  const reason = input.reason.trim();
  if (reason === '' || reason.length > CREW_REQUEST_REASON_MAX_LENGTH || !isOneLine(reason)) {
    return refuse('INVALID_CREW_REQUEST_REASON', `A reason is one line of at most ${String(CREW_REQUEST_REASON_MAX_LENGTH)} characters`);
  }
  const back: GiveBack = { trierarchShipId, settingsVersion: input.settingsVersion, reason, givenBackAt: input.at };
  return ok({
    request: {
      ...current,
      assignedTo: null,
      status: null,
      attempt: 0,
      sessionStartedAt: null,
      givenBack: [...current.givenBack.filter((held) => held.trierarchShipId !== trierarchShipId), back],
    },
    events: [
      event(ship, { at: input.at, actor: input.actor, type: 'CrewRequestGivenBack', details: { trierarchShipId, settingsVersion: input.settingsVersion, reason } }),
    ],
  });
}

/**
 * Whether the caller reaches the ship for a fleet action it may take with one
 * of the broad scopes, or with crew:run: crew:run reaches only the ships
 * whose requests are assigned to the caller's ship (decision 0029).
 */
export function checkReaches(
  caller: Caller,
  { ship, current, broadScopes }: { ship: Ship; current: CrewRequest | null | undefined; broadScopes: readonly Scope[] },
): Result<void, NotTheCallers> {
  if (broadScopes.some((scope) => hasScope(caller, scope))) {
    return ok(undefined);
  }
  return current?.assignedTo === caller.shipId
    ? ok(undefined)
    : refuse('CREW_REQUEST_NOT_ASSIGNED_TO_CALLER', `${ship.name}'s crew request is not assigned to your ship`);
}
