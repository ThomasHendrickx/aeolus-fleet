/** Approved meeting-list scenarios, run against in-memory ports and Postgres. */
import { idSchema, meetingsInputSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { expect, it } from 'vitest';

import { unwrap } from '../../src/testing/result.js';
import type { Meeting } from '../../src/domain/messaging/meeting.js';
import type { ListMeetings } from '../../src/domain/messaging/list-meetings.js';

export const OPENED = new Date('2026-11-21T10:00:00.000Z');
export const ENDED = new Date('2026-11-21T11:00:00.000Z');
export const CONTRIBUTED = new Date('2026-11-21T10:30:00.000Z');

export interface MeetingListHarness {
  fleetId: FleetId;
  shipId: ShipId;
  ownerId: ShipId;
  moderatorId: ShipId;
  otherId: ShipId;
  add(meeting: Meeting): Promise<void>;
  contribute(meeting: Meeting, at: Date): Promise<void>;
  removeOwner(): Promise<void>;
  list: (input?: Parameters<ListMeetings>[1]) => ReturnType<ListMeetings>;
}

export function meetingId(serial: number) {
  return idSchema('meeting').parse(`mtg_${String(serial).padStart(26, '0')}`);
}

export function aMeetingForList(h: MeetingListHarness, serial: number, overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: meetingId(serial), fleetId: h.fleetId, title: 'Planning',
    ownerShipId: h.ownerId, moderatorShipId: h.moderatorId, openedByShipId: h.ownerId,
    idempotencyKey: `meeting-${String(serial)}`, requestHash: 'hash', openedAt: OPENED, endedAt: null,
    micHolderShipId: h.moderatorId, micPattern: 'moderator',
    participants: [h.ownerId, h.moderatorId, h.shipId, h.otherId].map((shipId) => ({ shipId, joinedAt: OPENED, leftAt: null, isRevoked: false })),
    micRequests: [{ shipId: h.ownerId, requestedAt: OPENED }, { shipId: h.shipId, requestedAt: OPENED }],
    ...overrides,
  };
}

export function meetingListScenarios(harness: () => MeetingListHarness): void {
  it('lists open before ended, newest opened first and descending id on a tie, without duplicates or skips across pages', async () => {
    // Given two sections, different opening times, and ties in each section.
    const h = harness();
    for (const serial of [1, 4, 2, 5, 3, 6]) {
      await h.add(aMeetingForList(h, serial, {
        openedAt: serial === 1 || serial === 4 ? new Date('2026-11-20T10:00:00.000Z') : OPENED,
        endedAt: serial >= 4 ? ENDED : null,
      }));
    }

    // When the ship continues through pages of two, crossing the section boundary.
    const first = unwrap(await h.list({ limit: 2 }));
    const second = unwrap(await h.list({ limit: 2, cursor: first.nextCursor ?? undefined }));
    const third = unwrap(await h.list({ limit: 2, cursor: second.nextCursor ?? undefined }));

    // Then each meeting appears once in the approved order, with a cursor in both sections.
    expect([first, second, third].flatMap((page) => page.items.map((item) => item.meetingId))).toEqual([meetingId(3), meetingId(2), meetingId(1), meetingId(6), meetingId(5), meetingId(4)]);
    expect(first.nextCursor).toBe(`o.${String(OPENED.getTime())}.${meetingId(2)}`);
    expect(second.nextCursor).toBe(`e.${String(OPENED.getTime())}.${meetingId(6)}`);
    expect(third.nextCursor).toBeNull();
  });

  it('returns every envelope field, present count and waiting place without reading contributions', async () => {
    // Given a titled meeting with distinct owner, moderator and holder, one former participant, and a kept contribution time.
    const h = harness();
    const meeting = aMeetingForList(h, 1);
    meeting.participants = meeting.participants.map((p) => p.shipId === h.otherId ? { ...p, leftAt: ENDED, isRevoked: true } : p);
    await h.add(meeting);
    await h.contribute(meeting, CONTRIBUTED);

    // When its waiting ship reads the list.
    const page = unwrap(await h.list());

    // Then all fields come back, with the caller second in line and only present participants counted.
    expect(page).toEqual({ items: [{
      meetingId: meeting.id, title: 'Planning', openedAt: OPENED, endedAt: null,
      owner: { id: h.ownerId, name: 'owner' }, moderator: { id: h.moderatorId, name: 'moderator' },
      presentParticipants: 3, micHolder: { id: h.moderatorId, name: 'moderator' }, placeInLine: 2,
      lastContributionAt: CONTRIBUTED, participantState: 'present',
    }], nextCursor: null });
  });

  it.each(['present', 'left', 'revoked'] as const)('includes a %s participant and its state, even after the meeting ends', async (state) => {
    // Given an ended meeting in which the caller has the named state.
    const h = harness();
    const meeting = aMeetingForList(h, 1, { endedAt: ENDED, title: null, micHolderShipId: null, micRequests: [] });
    meeting.participants = meeting.participants.map((p) => p.shipId === h.shipId ? { ...p, leftAt: state === 'present' ? null : ENDED, isRevoked: state === 'revoked' } : p);
    await h.add(meeting);

    // When it lists its meetings.
    const page = unwrap(await h.list());

    // Then its right to read remains and nullable envelope facts stay null.
    expect(page).toEqual({ items: [{ meetingId: meeting.id, title: null, openedAt: OPENED, endedAt: ENDED,
      owner: { id: h.ownerId, name: 'owner' }, moderator: { id: h.moderatorId, name: 'moderator' },
      presentParticipants: state === 'present' ? 4 : 3, micHolder: null, placeInLine: null, lastContributionAt: null, participantState: state,
    }], nextCursor: null });
  });

  it.each(['holding', 'not requested'] as const)('answers no place in line for a ship %s', async (state) => {
    // Given a caller holding the mic or absent from the request line.
    const h = harness();
    await h.add(aMeetingForList(h, 1, { micHolderShipId: state === 'holding' ? h.shipId : null, micRequests: [] }));

    // When it lists its meetings.
    const page = unwrap(await h.list());

    // Then no place is invented, and the holder is identified when present.
    expect(page.items[0]?.placeInLine).toBeNull();
    expect(page.items[0]?.micHolder).toEqual(state === 'holding' ? { id: h.shipId, name: 'reader' } : null);
  });

  it('keeps a removed owner by its remnant name', async () => {
    // Given an ended meeting whose owner was removed.
    const h = harness();
    await h.add(aMeetingForList(h, 1, { endedAt: ENDED }));
    await h.removeOwner();

    // When a participant lists it.
    const page = unwrap(await h.list());

    // Then the remnant still supplies the owner identity.
    expect(page.items[0]?.owner).toEqual({ id: h.ownerId, name: 'owner' });
  });

  it('defaults to 20, accepts 100, and continues after the last returned row', async () => {
    // Given 105 meetings at the same opening time.
    const h = harness();
    for (let serial = 1; serial <= 105; serial += 1) await h.add(aMeetingForList(h, serial));

    // When no limit is supplied, or the maximum validated limit is supplied.
    const usual = unwrap(await h.list());
    const maximum = unwrap(await h.list(meetingsInputSchema.parse({ limit: 100 })));
    const rest = unwrap(await h.list({ limit: 100, cursor: maximum.nextCursor ?? undefined }));

    // Then the pages have the requested bounds and none is lost at the boundary.
    expect(usual.items).toHaveLength(20);
    expect(usual.items[0]?.meetingId).toBe(meetingId(105));
    expect(usual.nextCursor).toBe(`o.${String(OPENED.getTime())}.${meetingId(86)}`);
    expect(maximum.items).toHaveLength(100);
    expect(rest.items.map((item) => item.meetingId)).toEqual([meetingId(5), meetingId(4), meetingId(3), meetingId(2), meetingId(1)]);
    expect(rest.nextCursor).toBeNull();
  });

  it('lists nothing when the ship takes no part, without exposing other meetings', async () => {
    // Given a meeting with only its owner as participant.
    const h = harness();
    await h.add(aMeetingForList(h, 1, { participants: [{ shipId: h.ownerId, joinedAt: OPENED, leftAt: null, isRevoked: false }], micRequests: [] }));

    // When a ship outside the meeting lists its own meetings.
    const page = unwrap(await h.list());

    // Then no meeting or cursor is exposed.
    expect(page).toEqual({ items: [], nextCursor: null });
  });
}
