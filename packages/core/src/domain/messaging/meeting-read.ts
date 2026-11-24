/** A meeting read cutoff is a contribution, and every retained participant may mark through it. */
import { MEETING_CALL_CONTENT_TYPE, type MeetingId, type MessageId, type ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { Meeting } from './meeting.js';
import type { Message } from './message.js';

export function checkMeetingReadUpTo(input: { meeting: Meeting | undefined; message: Message | undefined; meetingId: MeetingId; messageId: MessageId; shipId: ShipId }): Result<undefined, DomainError<'MEETING_NOT_FOUND' | 'MESSAGE_NOT_FOUND'>> {
  if (!input.meeting?.participants.some((participant) => participant.shipId === input.shipId)) {
    return refuse('MEETING_NOT_FOUND', `Meeting ${input.meetingId} does not exist or you are not one of its participants`);
  }
  if (input.message?.meetingId !== input.meetingId || input.message.selector.kind !== 'meeting' || input.message.contentType === MEETING_CALL_CONTENT_TYPE) {
    return refuse('MESSAGE_NOT_FOUND', `Message ${input.messageId} is not a contribution in meeting ${input.meetingId}`);
  }
  return ok(undefined);
}
