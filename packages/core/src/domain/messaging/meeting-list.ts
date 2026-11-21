/** The meeting envelope read for one participant, with no contribution payloads. */
import type { MeetingId, ParticipantState } from '@aeolus-fleet/common';

import type { MeetingParty } from './read-meeting.js';

export interface ListedMeeting {
  meetingId: MeetingId;
  title: string | null;
  openedAt: Date;
  endedAt: Date | null;
  owner: MeetingParty;
  moderator: MeetingParty;
  presentParticipants: number;
  micHolder: MeetingParty | null;
  placeInLine: number | null;
  lastContributionAt: Date | null;
  participantState: ParticipantState;
}

/** The last row's stable section, opening time and id, in the approved cursor format. */
export function meetingListCursor(meeting: ListedMeeting): string {
  return `${meeting.endedAt === null ? 'o' : 'e'}.${String(meeting.openedAt.getTime())}.${meeting.meetingId}`;
}
