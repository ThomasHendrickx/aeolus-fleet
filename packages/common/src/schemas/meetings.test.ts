import { describe, expect, it } from 'vitest';
import { meetingListEntrySchema, meetingsCursorSchema, meetingsInputSchema, meetingsOutputSchema } from './meeting.js';

const meetingId = `mtg_${'1'.padStart(26, '0')}`;
const shipId = `shp_${'1'.padStart(26, '0')}`;

describe('the approved meeting list contract', () => {
  it('accepts absent input and page sizes from 1 to 100, refusing other limits', () => {
    // Given the list permits no input, and a caller may ask for 1 to 100 rows.
    // When the input is parsed.
    for (const input of [undefined, {}, { limit: 1 }, { limit: 20 }, { limit: 100 }]) expect(meetingsInputSchema.safeParse(input).success).toBe(true);
    // Then anything outside that bound is refused rather than silently changed.
    for (const limit of [0, -1, 101, 1.5, '20']) expect(meetingsInputSchema.safeParse({ limit }).success).toBe(false);
  });

  it('accepts only a section, an epoch millisecond time and a meeting id as a cursor', () => {
    // Given cursors in each section.
    // When the contract checks them.
    for (const section of ['o', 'e']) expect(meetingsCursorSchema.safeParse(`${section}.1795255200000.${meetingId}`).success).toBe(true);
    // Then malformed, fractional, unsafe and out-of-date-range positions are refused.
    for (const cursor of ['', `x.1.${meetingId}`, `o.NaN.${meetingId}`, `o.1.5.${meetingId}`, `o.9007199254740992.${meetingId}`, `o.8640000000000001.${meetingId}`, 'o.1.shp_00000000000000000000000001', `o.1.${meetingId}.extra`]) {
      expect(meetingsCursorSchema.safeParse(cursor).success, cursor).toBe(false);
    }
  });

  it('describes each envelope field and an empty final page without payloads', () => {
    // Given the approved envelope facts.
    const entry = { meetingId, title: null, openedAt: '2026-11-21T10:00:00.000Z', endedAt: null, owner: { id: shipId, name: 'owner' }, moderator: { id: shipId, name: 'owner' }, presentParticipants: 1, micHolder: null, placeInLine: null, lastContributionAt: null, participantState: 'present' };
    // When the schemas parse an entry and its page.
    expect(meetingListEntrySchema.parse(entry)).toEqual(entry);
    // Then the page exposes only the envelope and its continuation.
    expect(meetingsOutputSchema.parse({ items: [entry], nextCursor: null })).toEqual({ items: [entry], nextCursor: null });
    expect(meetingsOutputSchema.parse({ items: [], nextCursor: null })).toEqual({ items: [], nextCursor: null });
  });
});
