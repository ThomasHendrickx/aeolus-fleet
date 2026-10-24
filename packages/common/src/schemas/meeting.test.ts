import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  giveMicInputSchema,
  MEETING_ADDED_CONTENT_TYPE,
  MEETING_MIC_CONTENT_TYPE,
  MEETING_TITLE_MAX_LENGTH,
  meetingAddedSchema,
  meetingInputSchema,
  meetingMicSchema,
  meetingOutputSchema,
  micInputSchema,
  openMeetingInputSchema,
  setMicPatternInputSchema,
} from './meeting.js';

const newId = createIdGenerator();

describe('openMeetingInputSchema (decision 0061)', () => {
  it('takes the invitees by ship id and by name, a label selection, a key and the model', () => {
    const input = {
      ships: [{ shipId: newId('ship') }, { name: 'head-of-product' }],
      valueIds: [newId('labelValue')],
      idempotencyKey: 'weekly-heads',
      model: 'claude-opus-5-5',
      title: 'Weekly heads',
    };

    expect(openMeetingInputSchema.parse(input)).toEqual(input);
  });

  it(`takes a title of ${String(MEETING_TITLE_MAX_LENGTH)} characters, trimmed, and refuses one over`, () => {
    const exact = 'a'.repeat(MEETING_TITLE_MAX_LENGTH);

    expect(openMeetingInputSchema.parse({ ships: [{ name: 'scout' }], idempotencyKey: 'k', title: `  ${exact}  ` }).title).toBe(exact);
    expect(openMeetingInputSchema.safeParse({ ships: [{ name: 'scout' }], idempotencyKey: 'k', title: `${exact}a` }).error?.issues[0]?.message).toBe(
      `A meeting title is at most ${String(MEETING_TITLE_MAX_LENGTH)} characters`,
    );
  });

  it('takes a label selection alone, with no ship named', () => {
    const input = { valueIds: [newId('labelValue')], idempotencyKey: 'weekly-heads' };

    expect(openMeetingInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    ['an invitee that names a type', { ships: [{ type: 'reviewer' }], idempotencyKey: 'k' }],
    ['an invitee with both id and name', { ships: [{ shipId: newId('ship'), name: 'scout' }], idempotencyKey: 'k' }],
    ['a label selection of label ids', { valueIds: [newId('label')], idempotencyKey: 'k' }],
    ['no idempotency key', { ships: [{ name: 'scout' }] }],
  ])('refuses %s', (_label, input) => {
    expect(openMeetingInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('meetingInputSchema', () => {
  it('takes the meeting and a page of its contributions', () => {
    const input = { meetingId: newId('meeting'), cursor: newId('message'), limit: 20 };

    expect(meetingInputSchema.parse(input)).toEqual(input);
  });

  it('refuses a meeting id of another kind', () => {
    expect(meetingInputSchema.safeParse({ meetingId: newId('ship') }).success).toBe(false);
  });
});

describe('the added notice (decision 0061)', () => {
  it('is of the meeting added content type', () => {
    expect(MEETING_ADDED_CONTENT_TYPE).toBe('application/vnd.aeolus.meeting.added+json');
  });

  it('carries the meeting, its title, its owner, its moderator and its participants by id and name', () => {
    const owner = { id: newId('ship'), name: 'chief-of-staff' };
    const notice = { meetingId: newId('meeting'), title: 'Weekly heads', owner, moderator: owner, participants: [owner, { id: newId('ship'), name: 'head-of-product' }] };

    expect(meetingAddedSchema.parse(notice)).toEqual(notice);
  });

  it('carries a null title for a meeting opened without one', () => {
    const owner = { id: newId('ship'), name: 'chief-of-staff' };

    expect(meetingAddedSchema.safeParse({ meetingId: newId('meeting'), title: null, owner, moderator: owner, participants: [owner] }).success).toBe(true);
  });
});

describe('the mic calls (decision 0061, M7 to M10)', () => {
  it('name the meeting, for a request, a withdrawal, a release and a take', () => {
    const input = { meetingId: newId('meeting') };

    expect(micInputSchema.parse(input)).toEqual(input);
  });

  it('give the mic to one participant by id', () => {
    const input = { meetingId: newId('meeting'), shipId: newId('ship') };

    expect(giveMicInputSchema.parse(input)).toEqual(input);
  });

  it.each(['moderator', 'fifo'])('set the pattern %s', (pattern) => {
    const input = { meetingId: newId('meeting'), pattern };

    expect(setMicPatternInputSchema.parse(input)).toEqual(input);
  });

  it('refuse a pattern that is neither', () => {
    expect(setMicPatternInputSchema.safeParse({ meetingId: newId('meeting'), pattern: 'roundRobin' }).success).toBe(false);
  });
});

describe('the mic in the meeting read', () => {
  it('shows who holds it (null when free), its pattern, and the requests oldest first with their time', () => {
    const chief = { id: newId('ship'), name: 'chief' };
    const product = { id: newId('ship'), name: 'product' };
    const read = {
      meetingId: newId('meeting'),
      title: null,
      owner: chief,
      moderator: chief,
      openedAt: '2026-10-24T09:00:00.000Z',
      endedAt: null,
      participants: [],
      mic: { holder: null, pattern: 'fifo', requests: [{ ship: product, requestedAt: '2026-10-24T09:01:00.000Z' }] },
      contributions: { items: [], nextCursor: null },
    };

    expect(meetingOutputSchema.parse(read)).toEqual(read);
  });
});

describe('the mic notice (decision 0061, M11)', () => {
  it('is of the meeting mic content type', () => {
    expect(MEETING_MIC_CONTENT_TYPE).toBe('application/vnd.aeolus.meeting.mic+json');
  });

  it('names the meeting whose mic the ship now holds', () => {
    const notice = { meetingId: newId('meeting') };

    expect(meetingMicSchema.parse(notice)).toEqual(notice);
  });
});
