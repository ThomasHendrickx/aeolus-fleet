/** A present person closes a named call, with its round and events committed together. */
import type { IdGenerator, MeetingId, MessageId } from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { closeCallByPersonWithin, type CallCloseTx } from './call-round.js';
import { withDataKeys, type DataKeysNeeded, type PayloadSealing } from './data-keys.js';
import type { PresenceRefusal } from './meeting.js';
import { checkCallClose } from './meeting-call.js';
import type { AcceptRefusal } from './message.js';
import type { MeetingRepository, RequestHasher } from './ports.js';

export interface CloseCallTx extends CallCloseTx {
  meetings: Pick<MeetingRepository, 'findForUpdate' | 'findCall' | 'saveCall' | 'closedCallCount' | 'save' | 'contributed'>;
}
export type CloseCallRefusal = PresenceRefusal | AcceptRefusal | DomainError<'NOT_PERSON' | 'MESSAGE_NOT_FOUND' | 'KEY_UNAVAILABLE'>;
export type CloseCall = (caller: ShipCaller, input: Readonly<{ meetingId: MeetingId; callId: MessageId }>) => Promise<Result<undefined, CloseCallRefusal>>;

export function createCloseCall(deps: { uow: UnitOfWork<CloseCallTx>; clock: Clock; ids: IdGenerator; hasher: RequestHasher; sealing: PayloadSealing }): CloseCall {
  return (caller, input) => withDataKeys({ sealing: deps.sealing, fleetId: caller.fleetId }, (held) => deps.uow.run(async (tx): Promise<Result<undefined, CloseCallRefusal | DataKeysNeeded>> => {
    const at = deps.clock.now();
    const meeting = await tx.meetings.findForUpdate(caller.fleetId, input.meetingId);
    const call = await tx.meetings.findCall(caller.fleetId, input);
    const allowed = checkCallClose({ meeting, call }, { meetingId: input.meetingId, by: caller.shipId, byKind: caller.kind, at });
    if (!allowed.isOk) return allowed;
    if (allowed.value.call.closedAt !== null) return ok(undefined);
    const closed = await closeCallByPersonWithin({ tx, ids: deps.ids, hasher: deps.hasher, held }, { ...allowed.value, by: caller.shipId, at });
    return closed.isOk ? ok(undefined) : closed;
  }));
}
