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

/** The longest reason the assigner may write on a crew request: one line, as a report's note. */
export const CREW_REQUEST_REASON_MAX_LENGTH = 200;

const REASON_MESSAGE = `A reason is one line of at most ${String(CREW_REQUEST_REASON_MAX_LENGTH)} characters`;

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
  /** Why no trierarch can take it, written by the assigner while unassigned; null when none. */
  reason: z.string().nullable(),
  /** The ship that got the starting prompt the ship's crew claimed with: argo for a hand crew, or its trierarch; null while not crewed. */
  crewedBy: z.object({ id: idSchema('ship'), name: z.string() }).nullable(),
  /** How many times its trierarch restarted the session within its restart window, with the status: 0 on its first start. */
  attempt: z.int().min(0),
  /** When the session its trierarch runs now started, with the status; null while none runs. */
  startedAt: z.iso.datetime().nullable(),
  /** The trierarchs that gave it back before their crew was final, oldest first (#382): placement leaves them out. Cleared on every new settings version. */
  givenBack: z.array(
    z.object({ trierarch: z.object({ id: idSchema('ship'), name: z.string() }), settingsVersion: z.int().min(1), reason: z.string(), givenBackAt: z.iso.datetime() }),
  ),
});

/** A ship's crew request whole, for its page: as the fleet list shows it, with its settings. */
export const crewRequestSchema = listedCrewRequestSchema.extend({ settings: crewRequestSettingsSchema });

/** Input of `fleet.assignCrew` (crew:assign): the ship whose request to assign, and the trierarch ship that crews it. */
export const assignCrewInputSchema = z.object({ shipId: idSchema('ship'), trierarchShipId: idSchema('ship') });

/** Output of `fleet.assignCrew`: nothing; the OK is the answer. */
export const assignCrewOutputSchema = z.strictObject({});

/** Input of `fleet.reportCrewStatus` (crew:run): the ship and how its crew stands. */
export const reportCrewStatusInputSchema = z.object({
  shipId: idSchema('ship'),
  status: crewStatusSchema,
  /** How many times the trierarch restarted the session within its restart window: 0 on its first start (#332). Left out, 0. */
  attempt: z.int().min(0).optional(),
  /** When the session it runs now started (ISO 8601 in UTC); null while none runs. Left out, null. */
  startedAt: z.iso.datetime().nullable().optional(),
});

/** Output of `fleet.reportCrewStatus`: nothing; the OK is the answer. */
export const reportCrewStatusOutputSchema = z.strictObject({});

/** Input of `fleet.confirmCrewRelease` (crew:run): the ship of the releasing request. */
export const confirmCrewReleaseInputSchema = z.object({ shipId: idSchema('ship') });

/** Output of `fleet.confirmCrewRelease`: nothing; the OK is the answer. */
export const confirmCrewReleaseOutputSchema = z.strictObject({});

/**
 * Output of `fleet.assignedCrewRequests` (crew:run): the crew requests
 * assigned to the caller's ship, oldest ship first (ISO 8601 in UTC), each
 * saying whether its crew is final, so its trierarch never derives it (#477).
 */
export const assignedCrewRequestsOutputSchema = z.array(
  z.object({
    shipId: idSchema('ship'),
    settings: crewRequestSettingsSchema,
    settingsVersion: z.int().min(1),
    requestedAt: z.iso.datetime(),
    status: crewStatusSchema.nullable(),
    /** Whether its crew is final (decision 0029): kept whatever status follows, cleared on every new settings version. */
    isFinal: z.boolean(),
  }),
);

/**
 * Input of `fleet.explainCrewRequest` (crew:assign): why no trierarch can
 * take the ship's unassigned request, trimmed, one line; null clears it.
 */
export const explainCrewRequestInputSchema = z.object({
  shipId: idSchema('ship'),
  reason: z
    .string()
    .trim()
    .max(CREW_REQUEST_REASON_MAX_LENGTH, REASON_MESSAGE)
    .refine((reason) => !/[\r\n]/.test(reason), REASON_MESSAGE)
    .nullable(),
});

/** Output of `fleet.explainCrewRequest`: nothing; the OK is the answer. */
export const explainCrewRequestOutputSchema = z.strictObject({});

/**
 * Input of `fleet.giveBackCrewRequest` (crew:run): the assigned trierarch
 * gives back a request it tried to fulfil and failed, while its crew is not
 * final (#382): the ship, the settings version it tried, and why, one line.
 */
export const giveBackCrewRequestInputSchema = z.object({
  shipId: idSchema('ship'),
  settingsVersion: z.int().min(1),
  reason: z
    .string()
    .trim()
    .min(1, REASON_MESSAGE)
    .max(CREW_REQUEST_REASON_MAX_LENGTH, REASON_MESSAGE)
    .refine((reason) => !/[\r\n]/.test(reason), REASON_MESSAGE),
});

/** Output of `fleet.giveBackCrewRequest`: nothing; the OK is the answer. */
export const giveBackCrewRequestOutputSchema = z.strictObject({});
