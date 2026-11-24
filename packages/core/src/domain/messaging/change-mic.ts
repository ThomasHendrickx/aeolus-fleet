import type { IdGenerator, MeetingId, MessageId } from '@aeolus-fleet/common';

import type { ShipRepository } from '../registry/public.js';
import { isCrew, type ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { recordEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { withDataKeys, sealedFor, type DataKeysNeeded, type PayloadSealing } from './data-keys.js';
import { tellOfChange, type MeetingNoticeTx } from './meeting-notice.js';
import type { Meeting } from './meeting.js';
import type { AcceptRefusal } from './message.js';
import { changeMic, checkRequestWords, type MicChange, type MicRefusal } from './mic.js';
import type { MeetingRepository, RequestHasher } from './ports.js';
import type { MeetingParty, MicRead } from './read-meeting.js';

export interface ChangeMicTx extends MeetingNoticeTx {
  meetings: Pick<MeetingRepository, 'findForUpdate' | 'save' | 'contributed'>;
  ships: Pick<ShipRepository, 'findMany'>;
}

export type ChangeMicFailure = MicRefusal | AcceptRefusal | DomainError<'KEY_UNAVAILABLE' | 'PAYLOAD_TOO_LARGE' | 'INVALID_CONTENT_TYPE'>;

export interface RequestMicResponse {
  mic: MicRead;
  caller: { kind: 'holding' } | { kind: 'waiting'; place: number } | { kind: 'said'; messageId: MessageId };
}

export type ChangeMic = (caller: ShipCaller, input: { meetingId: MeetingId; change: MicChange }) => Promise<Result<RequestMicResponse | undefined, ChangeMicFailure>>;

/**
 * Changes the mic of a meeting the caller takes part in (decision 0061, M7 to
 * M11), in one unit of work with its events. The meeting is held for update,
 * so mic changes take turns and a contribution in flight finishes first. The
 * ship that gets the mic is told by its holding response to a request, or by
 * a message from the moderator otherwise. That message states
 * no model: the change may be another ship's, as a release under first in line.
 * In a sealed fleet that notice is sealed with data keys unwrapped before the
 * unit of work (decision 0068, B17).
 */
export function createChangeMic(deps: { uow: UnitOfWork<ChangeMicTx>; clock: Clock; ids: IdGenerator; hasher: RequestHasher; sealing: PayloadSealing }): ChangeMic {
  return (caller, input) =>
    withDataKeys({ sealing: deps.sealing, fleetId: caller.fleetId }, (held) => deps.uow.run(async (tx): Promise<Result<RequestMicResponse | undefined, ChangeMicFailure | DataKeysNeeded>> => {
      const { fleetId } = caller;
      const at = deps.clock.now();
      const before = await tx.meetings.findForUpdate(fleetId, input.meetingId);
      let change = input.change;
      if (change.kind === 'request' && change.payload !== undefined) {
        const checked = checkRequestWords(before, { meetingId: input.meetingId, by: caller.shipId, at, payload: change.payload, contentType: change.contentType, model: change.model, senderKind: caller.kind });
        if (!checked.isOk) return checked;
        const messageId = deps.ids('message');
        const payload = sealedFor(held, { currentDataKeyId: await tx.sealings.currentDataKeyId(fleetId), row: { fleetId, rowId: messageId }, payload: change.payload });
        if (!payload.isOk) return payload;
        change = { ...change, words: { messageId, payload: payload.value, contentType: checked.value.contentType, model: change.model, senderKind: caller.kind, senderLeaseId: isCrew(caller) ? caller.leaseId : null, signedInAccountId: caller.signedInAccountId } };
      }
      const changed = changeMic(before, { meetingId: input.meetingId, by: caller.shipId, change, at });
      if (!changed.isOk) {
        return changed;
      }
      const { meeting, events, givenTo, said } = changed.value;
      await tx.meetings.save(meeting);
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      const isCallerToldByResponse = input.change.kind === 'request' && givenTo === caller.shipId;
      const told = await tellOfChange({ tx, ids: deps.ids, hasher: deps.hasher, held }, { meeting, micGivenTo: isCallerToldByResponse ? null : givenTo, said, saidByResponse: input.change.kind === 'request' ? caller.shipId : undefined, endedBy: null, at });
      if (!told.isOk) {
        return told;
      }
      const response = input.change.kind === 'request' ? await requestResponse(tx, { meeting, callerShipId: caller.shipId }) : undefined;
      const words = told.value.said.find((request) => request.shipId === caller.shipId);
      return ok(response !== undefined && words !== undefined ? { ...response, caller: { kind: 'said', messageId: words.messageId } } : response);
    }));
}

async function requestResponse(tx: ChangeMicTx, { meeting, callerShipId }: { meeting: Meeting; callerShipId: ShipCaller['shipId'] }): Promise<RequestMicResponse> {
  // One read for the holder and the whole queue: a ship waits once, so the ids are as many as the meeting has participants.
  const named = [...new Set([...(meeting.micHolderShipId === null ? [] : [meeting.micHolderShipId]), ...meeting.micRequests.map(({ shipId }) => shipId)])];
  const names = new Map((await tx.ships.findMany(meeting.fleetId, named)).map(({ id, name }) => [id, name]));
  const party = (shipId: ShipCaller['shipId']): MeetingParty => ({ id: shipId, name: names.get(shipId) ?? shipId });
  const mic: MicRead = {
    holder: meeting.micHolderShipId === null ? null : party(meeting.micHolderShipId),
    pattern: meeting.micPattern,
    requests: meeting.micRequests.map((request) => ({ ship: party(request.shipId), requestedAt: request.requestedAt })),
  };
  if (meeting.micHolderShipId === callerShipId) {
    return { mic, caller: { kind: 'holding' } };
  }
  return { mic, caller: { kind: 'waiting', place: meeting.micRequests.findIndex((request) => request.shipId === callerShipId) + 1 } };
}
