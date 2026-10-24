import type { MeetingId, MicPattern, ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor, type Actor, type NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import { checkPresent, isPresent, type Meeting, type PresenceRefusal } from './meeting.js';

/**
 * The mic of a meeting (decision 0061, M7 to M10): who may contribute besides
 * the moderator, the requests waiting for it, and how a free mic passes.
 */

/** A ship waiting for the mic, since its time (M8). */
export interface MicRequest {
  shipId: ShipId;
  requestedAt: Date;
}

/**
 * One change of the mic: a participant requests it, withdraws its request or
 * releases it; the moderator gives it, takes it back or sets how it passes.
 */
export type MicChange =
  | { kind: 'request' }
  | { kind: 'withdraw' }
  | { kind: 'release' }
  | { kind: 'give'; shipId: ShipId }
  | { kind: 'take' }
  | { kind: 'setPattern'; pattern: MicPattern };

export type MicRefusal =
  | PresenceRefusal
  | DomainError<
  | 'MIC_ALREADY_REQUESTED'
  | 'MIC_ALREADY_HELD'
  | 'MODERATOR_NEEDS_NO_MIC'
  | 'MIC_NOT_REQUESTED'
  | 'MIC_NOT_HELD'
  | 'MIC_FREE'
  | 'NOT_MODERATOR'
  | 'PARTICIPANT_NOT_FOUND'
>;

/** The meeting after a change of its mic, its events, and the ship that got the mic by it, to be told (M11). */
export interface MicChanged {
  meeting: Meeting;
  events: NewEvent[];
  givenTo: ShipId | null;
}

/**
 * Changes the mic of the meeting for a participant present in it, open still
 * (`checkPresent`). First in line, a
 * free mic goes to the oldest request in the same change, by the moderator.
 */
export function changeMic(meeting: Meeting | undefined, input: { meetingId: MeetingId; by: ShipId; change: MicChange; at: Date }): Result<MicChanged, MicRefusal> {
  const present = checkPresent(meeting, { meetingId: input.meetingId, shipId: input.by, ended: 'its mic no longer changes' });
  if (!present.isOk) {
    return present;
  }
  const changed = applied(present.value, input);
  return changed.isOk ? ok(handedOn(changed.value, input.at)) : changed;
}

function applied(meeting: Meeting, input: { by: ShipId; change: MicChange; at: Date }): Result<MicChanged, MicRefusal> {
  const { by, change, at } = input;
  const details = { meetingId: meeting.id };
  const event = (type: NewEvent['type'], about: { shipId: ShipId; pattern?: MicPattern }): NewEvent => ({
    fleetId: meeting.fleetId,
    type,
    occurredAt: at,
    actor: shipActor(by),
    shipId: about.shipId,
    details: about.pattern === undefined ? details : { ...details, pattern: about.pattern },
  });
  const isModerator = by === meeting.moderatorShipId;
  switch (change.kind) {
    case 'request': {
      if (isModerator) {
        return moderatorNeedsNoMic(meeting);
      }
      if (meeting.micHolderShipId === by) {
        return refuse('MIC_ALREADY_HELD', `You hold the mic of meeting ${meeting.id} already: contribute, then release it`);
      }
      if (meeting.micRequests.some((request) => request.shipId === by)) {
        return refuse('MIC_ALREADY_REQUESTED', `You requested the mic of meeting ${meeting.id} already: wait for it, or withdraw the request`);
      }
      return ok({ meeting: { ...meeting, micRequests: [...meeting.micRequests, { shipId: by, requestedAt: at }] }, events: [event('MicRequested', { shipId: by })], givenTo: null });
    }
    case 'withdraw':
      if (!meeting.micRequests.some((request) => request.shipId === by)) {
        return refuse('MIC_NOT_REQUESTED', `You have no mic request in meeting ${meeting.id} to withdraw`);
      }
      return ok({ meeting: { ...meeting, micRequests: meeting.micRequests.filter((request) => request.shipId !== by) }, events: [event('MicRequestWithdrawn', { shipId: by })], givenTo: null });
    case 'release':
      if (meeting.micHolderShipId !== by) {
        return refuse('MIC_NOT_HELD', `You do not hold the mic of meeting ${meeting.id}`);
      }
      return ok({ meeting: { ...meeting, micHolderShipId: null }, events: [event('MicReleased', { shipId: by })], givenTo: null });
    case 'give': {
      if (!isModerator) {
        return notModerator(meeting);
      }
      if (change.shipId === meeting.moderatorShipId) {
        return moderatorNeedsNoMic(meeting);
      }
      if (!isPresent(meeting, change.shipId)) {
        return refuse('PARTICIPANT_NOT_FOUND', `Ship ${change.shipId} is not one of the participants of meeting ${meeting.id}`);
      }
      const former = meeting.micHolderShipId;
      return ok({
        meeting: { ...meeting, micHolderShipId: change.shipId, micRequests: meeting.micRequests.filter((request) => request.shipId !== change.shipId) },
        events: [...(former === null || former === change.shipId ? [] : [event('MicTaken', { shipId: former })]), event('MicGiven', { shipId: change.shipId, pattern: 'moderator' })],
        givenTo: change.shipId,
      });
    }
    case 'take': {
      if (!isModerator) {
        return notModerator(meeting);
      }
      const holder = meeting.micHolderShipId;
      if (holder === null) {
        return refuse('MIC_FREE', `Nobody holds the mic of meeting ${meeting.id}: there is nothing to take back`);
      }
      return ok({ meeting: { ...meeting, micHolderShipId: null }, events: [event('MicTaken', { shipId: holder })], givenTo: null });
    }
    case 'setPattern':
      if (!isModerator) {
        return notModerator(meeting);
      }
      return ok({ meeting: { ...meeting, micPattern: change.pattern }, events: [event('MicPatternSet', { shipId: by, pattern: change.pattern })], givenTo: null });
  }
}

/**
 * The meeting with the ship off its mic, as when it leaves, is revoked,
 * retires or is named moderator: its request goes, and the mic it held is
 * free, released when the ship itself caused it, taken otherwise. First in
 * line hands a freed mic on.
 */
export function offTheMic(meeting: Meeting, input: { shipId: ShipId; actor: Actor; at: Date }): MicChanged {
  const { shipId, actor, at } = input;
  const event = (type: 'MicRequestWithdrawn' | 'MicReleased' | 'MicTaken'): NewEvent => ({ fleetId: meeting.fleetId, type, occurredAt: at, actor, shipId, details: { meetingId: meeting.id } });
  const isRequested = meeting.micRequests.some((request) => request.shipId === shipId);
  const isHolder = meeting.micHolderShipId === shipId;
  const isItself = actor.kind === 'ship' && actor.shipId === shipId;
  const events = [...(isRequested ? [event('MicRequestWithdrawn')] : []), ...(isHolder ? [event(isItself ? 'MicReleased' : 'MicTaken')] : [])];
  const changed: MicChanged = {
    meeting: { ...meeting, micHolderShipId: isHolder ? null : meeting.micHolderShipId, micRequests: meeting.micRequests.filter((request) => request.shipId !== shipId) },
    events,
    givenTo: null,
  };
  return handedOn(changed, at);
}

/** First in line: a free mic goes to the oldest request, given by the moderator, who set the pattern (M9, M11). */
export function handedOn(changed: MicChanged, at: Date): MicChanged {
  const { meeting } = changed;
  const [oldest, ...waiting] = meeting.micRequests;
  if (meeting.micPattern !== 'fifo' || meeting.micHolderShipId !== null || oldest === undefined) {
    return changed;
  }
  const given: NewEvent = {
    fleetId: meeting.fleetId,
    type: 'MicGiven',
    occurredAt: at,
    actor: shipActor(meeting.moderatorShipId),
    shipId: oldest.shipId,
    details: { meetingId: meeting.id, pattern: 'fifo' },
  };
  return { meeting: { ...meeting, micHolderShipId: oldest.shipId, micRequests: waiting }, events: [...changed.events, given], givenTo: oldest.shipId };
}

function moderatorNeedsNoMic(meeting: Meeting): Result<never, MicRefusal> {
  return refuse('MODERATOR_NEEDS_NO_MIC', `You moderate meeting ${meeting.id}: the moderator always contributes and needs no mic`);
}

function notModerator(meeting: Meeting): Result<never, MicRefusal> {
  return refuse('NOT_MODERATOR', `Only the moderator of meeting ${meeting.id} gives the mic, takes it back and sets how it passes`);
}
