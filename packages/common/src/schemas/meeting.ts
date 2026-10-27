import { z } from 'zod';

import { shipKindSchema, shipStatusSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';
import { shipHandleSchema } from './fleet.js';
import { partySchema } from './history.js';
import { idempotencyKeySchema } from './idempotency-key.js';
import { modelSchema } from './message.js';
import { pageInputOf, pageOutputOf } from './page.js';

/**
 * Inputs and outputs of meetings (decision 0061): opening one
 * (`ship.openMeeting`), reading one (`ship.meeting`), the mic calls, and the
 * notices that tell a ship it was added or now holds the mic. A contribution is `ship.send` with the meeting
 * selector.
 */

/** ISO 8601 in UTC. */
const isoTime = z.iso.datetime();

/** The most characters a meeting's title holds: a short name a person reads when auditing later. */
export const MEETING_TITLE_MAX_LENGTH = 200;

/** An invitee: one ship, by id or by name, never a type. */
export const inviteeSchema = z.union([z.strictObject({ shipId: idSchema('ship') }), z.strictObject({ name: shipHandleSchema })]);

/**
 * Input of `ship.openMeeting` (meetings:open): the invitees by ship and by a
 * label selection (value ids, exact and AND), folded into one list with the
 * opener, which owns and moderates it; the opener's idempotency key; and the
 * model its session runs, which the added notices state; and an optional
 * short title.
 */
export const openMeetingInputSchema = z.object({
  ships: z.array(inviteeSchema).optional(),
  valueIds: z.array(idSchema('labelValue')).optional(),
  idempotencyKey: idempotencyKeySchema,
  model: modelSchema.optional(),
  title: z.string().trim().max(MEETING_TITLE_MAX_LENGTH, `A meeting title is at most ${String(MEETING_TITLE_MAX_LENGTH)} characters`).optional(),
});

export type OpenMeetingInput = z.infer<typeof openMeetingInputSchema>;

/** Output of `ship.openMeeting`: the meeting's id, the original one when the key was used before. */
export const openMeetingOutputSchema = z.object({ meetingId: idSchema('meeting') });

/** Input of `ship.meeting`: the meeting, and a page of its contributions, newest first. */
export const meetingInputSchema = pageInputOf(idSchema('message')).extend({ meetingId: idSchema('meeting') });

export type MeetingInput = z.infer<typeof meetingInputSchema>;

/**
 * How the mic passes when it is free (M9): the moderator gives it to whom it
 * likes, or it goes to the oldest request, first in line.
 */
export const MIC_PATTERNS = ['moderator', 'fifo'] as const;

export const micPatternSchema = z.enum(MIC_PATTERNS);

export type MicPattern = z.infer<typeof micPatternSchema>;

/**
 * Input of a call on a meeting alone: `ship.requestMic`, `ship.withdrawMicRequest`,
 * `ship.releaseMic`, `ship.takeMic`, `ship.leaveMeeting`, `ship.rejoinMeeting`
 * and `ship.endMeeting`.
 */
export const meetingIdInputSchema = z.object({ meetingId: idSchema('meeting') });

/**
 * Input of a call on a meeting and one of its ships: `ship.giveMic` (the
 * moderator), `ship.revokeFromMeeting`, `ship.transferMeeting` and
 * `ship.nameModerator` (the owner).
 */
export const meetingShipInputSchema = z.object({ meetingId: idSchema('meeting'), shipId: idSchema('ship') });

/**
 * Input of `ship.addToMeeting` (the owner): more invitees, by ship and by a
 * label selection, as an open names them, and the model the owner's session
 * runs, which the added notices state.
 */
export const addToMeetingInputSchema = z.object({
  meetingId: idSchema('meeting'),
  ships: z.array(inviteeSchema).optional(),
  valueIds: z.array(idSchema('labelValue')).optional(),
  model: modelSchema.optional(),
});

export type AddToMeetingInput = z.infer<typeof addToMeetingInputSchema>;

/** Input of `ship.setMicPattern` (the moderator): the meeting and how its mic passes from now. */
export const setMicPatternInputSchema = z.object({ meetingId: idSchema('meeting'), pattern: micPatternSchema });

/** Output of every mic call and every change of a meeting's life: nothing, once the change and its notices are stored. */
export const meetingChangedOutputSchema = z.object({});

/** The mic as the meeting read shows it: who holds it, null while free; its pattern; and the requests, oldest first. */
export const meetingMicReadSchema = z.object({
  holder: partySchema.nullable(),
  pattern: micPatternSchema,
  requests: z.array(z.object({ ship: partySchema, requestedAt: isoTime })),
});

/** Output of `ship.requestMic`: the mic as it stands after the request, and where the caller is in it. */
export const requestMicOutputSchema = z.object({
  mic: meetingMicReadSchema,
  caller: z.discriminatedUnion('kind', [z.object({ kind: z.literal('holding') }), z.object({ kind: z.literal('waiting'), place: z.int().min(1) })]),
});

/** Whether a participant is in the meeting now, left it keeping its right to rejoin, or was revoked by the owner (decision 0061, M13). */
export const PARTICIPANT_STATES = ['present', 'left', 'revoked'] as const;

export const participantStateSchema = z.enum(PARTICIPANT_STATES);

export type ParticipantState = z.infer<typeof participantStateSchema>;

/**
 * A participant as the meeting read shows it: who it is, whether it is crewed
 * now (decision 0061, M14), and whether it is in the meeting now.
 */
export const meetingParticipantSchema = partySchema.extend({ kind: shipKindSchema, status: shipStatusSchema, state: participantStateSchema });

/** One contribution as the meeting read shows it. */
export const contributionSchema = z.object({
  messageId: idSchema('message'),
  sender: partySchema,
  payload: z.string(),
  contentType: z.string(),
  model: z.string().nullable(),
  sentAt: isoTime,
});

/**
 * Output of `ship.meeting`: the meeting, its title (null without one), its owner and moderator, when it
 * opened and ended (null while open), its participants, its mic, and a page of its
 * contributions, newest first.
 */
export const meetingOutputSchema = z.object({
  meetingId: idSchema('meeting'),
  title: z.string().nullable(),
  owner: partySchema,
  moderator: partySchema,
  openedAt: isoTime,
  endedAt: isoTime.nullable(),
  participants: z.array(meetingParticipantSchema),
  mic: meetingMicReadSchema,
  contributions: pageOutputOf(contributionSchema, idSchema('message')),
});

export type MeetingOutput = z.infer<typeof meetingOutputSchema>;

/** The content type of the notice the owner sends each ship it added to a meeting. */
export const MEETING_ADDED_CONTENT_TYPE = 'application/vnd.aeolus.meeting.added+json';

/** The payload of the added notice: the meeting, its title (null without one), its owner, its moderator and its participants, by id and name. */
export const meetingAddedSchema = z.object({
  meetingId: idSchema('meeting'),
  title: z.string().nullable(),
  owner: partySchema,
  moderator: partySchema,
  participants: z.array(partySchema),
});

export type MeetingAdded = z.infer<typeof meetingAddedSchema>;

/** The content type of the notice the moderator sends the ship that now holds the mic. */
export const MEETING_MIC_CONTENT_TYPE = 'application/vnd.aeolus.meeting.mic+json';

/** The payload of the mic notice: the meeting whose mic the ship now holds. */
export const meetingMicSchema = z.object({ meetingId: idSchema('meeting') });

export type MeetingMic = z.infer<typeof meetingMicSchema>;

/** The content type of the notice the ship that ended a meeting sends every other participant. */
export const MEETING_ENDED_CONTENT_TYPE = 'application/vnd.aeolus.meeting.ended+json';

/** The payload of the ended notice: the meeting that ended. */
export const meetingEndedSchema = z.object({ meetingId: idSchema('meeting') });

export type MeetingEnded = z.infer<typeof meetingEndedSchema>;
