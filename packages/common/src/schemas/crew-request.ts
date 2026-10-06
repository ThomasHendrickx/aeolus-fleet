import { z } from 'zod';

import { idSchema } from '../ids/index.js';

/**
 * Inputs and outputs of the crew request procedures (decision 0029): a
 * standing request that a ship be kept crewed, with settings the server
 * stores without meaning. A requester with fleet:manage sets and removes it.
 */

/**
 * The most a crew request's settings may hold: 16 KB as the UTF-8 bytes of
 * their serialized JSON (decision 0029).
 */
export const CREW_REQUEST_SETTINGS_MAX_BYTES = 16 * 1024;

const utf8 = new TextEncoder();

/** The size of a crew request's settings: the UTF-8 bytes of their serialized JSON. */
export function crewRequestSettingsBytes(settings: CrewRequestSettings): number {
  return utf8.encode(JSON.stringify(settings)).byteLength;
}

/**
 * A crew request's settings: one JSON object (harness, workspace, options, an
 * optional first prompt, an optional squadron). Their shape is the trierarch
 * plugin's to check, not the server's.
 */
export const crewRequestSettingsSchema = z.record(z.string(), z.json());

export type CrewRequestSettings = z.infer<typeof crewRequestSettingsSchema>;

/**
 * How the assigned trierarch says its crew of the ship stands (decision 0029):
 * crewing, running, restarting, crashed, or releasing once the request is
 * removed.
 */
export const CREW_STATUSES = ['crewing', 'running', 'restarting', 'crashed', 'releasing'] as const;
export const crewStatusSchema = z.enum(CREW_STATUSES);
export type CrewStatus = z.infer<typeof crewStatusSchema>;

/** Input of `fleet.crewRequest`: the ship to keep crewed and its settings, replacing any it holds. */
export const crewRequestInputSchema = z.object({
  shipId: idSchema('ship'),
  settings: crewRequestSettingsSchema,
});

export type CrewRequestInput = z.infer<typeof crewRequestInputSchema>;

/** Output of `fleet.crewRequest`: the version of the settings now held, one more on every request. */
export const crewRequestOutputSchema = z.object({ settingsVersion: z.int().min(1) });

/** Input of `fleet.removeCrewRequest`: the ship whose crew request goes. */
export const removeCrewRequestInputSchema = z.object({ shipId: idSchema('ship') });

/** Output of `fleet.removeCrewRequest`: nothing; the OK is the answer. */
export const removeCrewRequestOutputSchema = z.strictObject({});

/**
 * A ship's crew request as the fleet list shows it (ISO 8601 in UTC): its
 * settings version, when it was requested, its assignment and its status,
 * never its settings.
 */
export const listedCrewRequestSchema = z.object({
  settingsVersion: z.int().min(1),
  requestedAt: z.iso.datetime(),
  /** The trierarch ship it is assigned to; null while unassigned, the operator's to-do. */
  assignedTo: z.object({ id: idSchema('ship'), name: z.string() }).nullable(),
  /** How its trierarch says the crew stands; null until it says. */
  status: crewStatusSchema.nullable(),
});

/** A ship's crew request whole, for its page: as the fleet list shows it, with its settings. */
export const crewRequestSchema = listedCrewRequestSchema.extend({ settings: crewRequestSettingsSchema });

/** Input of `fleet.assignCrew` (crew:assign): the ship whose request to assign, and the trierarch ship that crews it. */
export const assignCrewInputSchema = z.object({ shipId: idSchema('ship'), trierarchShipId: idSchema('ship') });

/** Output of `fleet.assignCrew`: nothing; the OK is the answer. */
export const assignCrewOutputSchema = z.strictObject({});

/** Input of `fleet.reportCrewStatus` (crew:run): the ship and how its crew stands. */
export const reportCrewStatusInputSchema = z.object({ shipId: idSchema('ship'), status: crewStatusSchema });

/** Output of `fleet.reportCrewStatus`: nothing; the OK is the answer. */
export const reportCrewStatusOutputSchema = z.strictObject({});

/** Input of `fleet.confirmCrewRelease` (crew:run): the ship of the releasing request. */
export const confirmCrewReleaseInputSchema = z.object({ shipId: idSchema('ship') });

/** Output of `fleet.confirmCrewRelease`: nothing; the OK is the answer. */
export const confirmCrewReleaseOutputSchema = z.strictObject({});

/**
 * Output of `fleet.assignedCrewRequests` (crew:run): the crew requests
 * assigned to the caller's ship, oldest ship first (ISO 8601 in UTC).
 */
export const assignedCrewRequestsOutputSchema = z.array(
  z.object({
    shipId: idSchema('ship'),
    settings: crewRequestSettingsSchema,
    settingsVersion: z.int().min(1),
    requestedAt: z.iso.datetime(),
    status: crewStatusSchema.nullable(),
  }),
);
