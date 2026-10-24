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
 * (`ship.openMeeting`), reading one (`ship.meeting`), and the notice that
 * tells a ship it was added. A contribution is `ship.send` with the meeting
 * selector.
 */

/** ISO 8601 in UTC. */
const isoTime = z.iso.datetime();

/** An invitee: one ship, by id or by name, never a type. */
export const inviteeSchema = z.union([z.strictObject({ shipId: idSchema('ship') }), z.strictObject({ name: shipHandleSchema })]);

/**
 * Input of `ship.openMeeting` (meetings:open): the invitees by ship and by a
 * label selection (value ids, exact and AND), folded into one list with the
 * opener, which owns and moderates it; the opener's idempotency key; and the
 * model its session runs, which the added notices state.
 */
export const openMeetingInputSchema = z.object({
  ships: z.array(inviteeSchema).optional(),
  valueIds: z.array(idSchema('labelValue')).optional(),
  idempotencyKey: idempotencyKeySchema,
  model: modelSchema.optional(),
});

export type OpenMeetingInput = z.infer<typeof openMeetingInputSchema>;

/** Output of `ship.openMeeting`: the meeting's id, the original one when the key was used before. */
export const openMeetingOutputSchema = z.object({ meetingId: idSchema('meeting') });

/** Input of `ship.meeting`: the meeting, and a page of its contributions, newest first. */
export const meetingInputSchema = pageInputOf(idSchema('message')).extend({ meetingId: idSchema('meeting') });

export type MeetingInput = z.infer<typeof meetingInputSchema>;

/** A participant as the meeting read shows it: who it is, and whether it is crewed now (decision 0061, M14). */
export const meetingParticipantSchema = partySchema.extend({ kind: shipKindSchema, status: shipStatusSchema });

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
 * Output of `ship.meeting`: the meeting, its owner and moderator, when it
 * opened and ended (null while open), its participants, and a page of its
 * contributions, newest first.
 */
export const meetingOutputSchema = z.object({
  meetingId: idSchema('meeting'),
  owner: partySchema,
  moderator: partySchema,
  openedAt: isoTime,
  endedAt: isoTime.nullable(),
  participants: z.array(meetingParticipantSchema),
  contributions: pageOutputOf(contributionSchema, idSchema('message')),
});

export type MeetingOutput = z.infer<typeof meetingOutputSchema>;

/** The content type of the notice the owner sends each ship it added to a meeting. */
export const MEETING_ADDED_CONTENT_TYPE = 'application/vnd.aeolus.meeting.added+json';

/** The payload of the added notice: the meeting, its owner, its moderator and its participants, by id and name. */
export const meetingAddedSchema = z.object({
  meetingId: idSchema('meeting'),
  owner: partySchema,
  moderator: partySchema,
  participants: z.array(partySchema),
});

export type MeetingAdded = z.infer<typeof meetingAddedSchema>;
