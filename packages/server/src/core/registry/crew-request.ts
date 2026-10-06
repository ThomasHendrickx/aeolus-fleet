import { CREW_REQUEST_SETTINGS_MAX_BYTES, crewRequestSettingsBytes, type FleetId, type ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { JsonObject } from './report-details.js';
import { checkCanBeRequestedCrew, type CrewRequestShipRefusal, type Ship } from './ship.js';

/**
 * A standing request that a ship be kept crewed (docs/blueprint.md, "Crew
 * request"): at most one per ship, with settings the server stores without
 * meaning (decision 0029). Each request replaces the settings whole and moves
 * their version by one, so whoever crews it notices the change.
 */
export interface CrewRequest {
  fleetId: FleetId;
  shipId: ShipId;
  settings: JsonObject;
  /** One on the first request, one more on every request after it. */
  settingsVersion: number;
  /** When the settings were last requested. */
  requestedAt: Date;
}

export type RequestCrewRefusal = CrewRequestShipRefusal | DomainError<'CREW_REQUEST_SETTINGS_TOO_LARGE'>;

/**
 * A requester asks that the ship be kept crewed, with these settings: the
 * request it holds now, replacing any it held, and CrewRequested with the
 * settings version, never the settings. Never argo, the viewer ship or a
 * retired ship; settings of at most 16 KB.
 */
export function requestCrew(
  { ship, current }: { ship: Ship; current: CrewRequest | undefined },
  input: { settings: JsonObject; at: Date; actor: Actor },
): Result<{ request: CrewRequest; events: NewEvent[] }, RequestCrewRefusal> {
  const requestable = checkCanBeRequestedCrew(ship);
  if (!requestable.isOk) {
    return requestable;
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
  };
  return ok({
    request,
    events: [
      {
        fleetId: ship.fleetId,
        type: 'CrewRequested',
        occurredAt: input.at,
        actor: input.actor,
        shipId: ship.id,
        details: { settingsVersion: request.settingsVersion },
      },
    ],
  });
}

/** A requester removes the ship's crew request: CrewRequestRemoved. Refused when the ship holds none. */
export function removeCrewRequest(
  { ship, current }: { ship: Ship; current: CrewRequest | undefined },
  input: { at: Date; actor: Actor },
): Result<{ events: NewEvent[] }, DomainError<'CREW_REQUEST_NOT_FOUND'>> {
  if (!current) {
    return refuse('CREW_REQUEST_NOT_FOUND', `${ship.name} has no crew request`);
  }
  return ok({ events: [{ fleetId: ship.fleetId, type: 'CrewRequestRemoved', occurredAt: input.at, actor: input.actor, shipId: ship.id }] });
}
