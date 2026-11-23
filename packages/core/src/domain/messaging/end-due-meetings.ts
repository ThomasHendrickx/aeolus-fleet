/** Closes durable meeting deadlines, one locked meeting and its notices per transaction. */
import type { FleetId, IdGenerator, MeetingId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { recordEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { withDataKeys, type DataKeysNeeded, type PayloadSealing } from './data-keys.js';
import { endAtDeadline } from './meeting-life.js';
import { tellOfChange, type MeetingNoticeTx } from './meeting-notice.js';
import type { AcceptRefusal } from './message.js';
import type { MeetingRepository, RequestHasher } from './ports.js';

export interface EndDueMeetingsTx extends MeetingNoticeTx {
  meetings: Pick<MeetingRepository, 'claimDue' | 'save'>;
}
export type EndMeetingFailed = (fleetId: FleetId, error: unknown) => void;
export type EndDueMeetings = (onError?: EndMeetingFailed) => Promise<{ nextAttemptAt: Date | undefined }>;

/** A failed transaction leaves the deadline due, so another pass or server recovers it. */
export function createEndDueMeetings(deps: {
  uow: UnitOfWork<EndDueMeetingsTx>;
  fleets: { list(): Promise<readonly { id: FleetId }[]> };
  meetings: Pick<MeetingRepository, 'nextEndTime'>;
  clock: Clock;
  ids: IdGenerator;
  hasher: RequestHasher;
  sealing: PayloadSealing;
}): EndDueMeetings {
  return async (onError) => {
    let nextAttemptAt: Date | undefined;
    for (const { id: fleetId } of await deps.fleets.list()) {
      const tried: MeetingId[] = [];
      for (;;) {
        const claimed: { id?: MeetingId } = {};
        try {
          const result = await withDataKeys({ sealing: deps.sealing, fleetId }, (held) => deps.uow.run(async (tx): Promise<Result<MeetingId | undefined, AcceptRefusal | DataKeysNeeded>> => {
            const meeting = await tx.meetings.claimDue(fleetId, { at: deps.clock.now(), tried });
            if (meeting === undefined) return ok(undefined);
            claimed.id = meeting.id;
            const changed = endAtDeadline(meeting, deps.clock.now());
            if (changed === undefined) return ok(undefined);
            await tx.meetings.save(changed.meeting);
            for (const event of changed.events) await recordEvent({ events: tx.events, ids: deps.ids }, event);
            const told = await tellOfChange({ tx, ids: deps.ids, hasher: deps.hasher, held }, { meeting: changed.meeting, micGivenTo: null, endedBy: meeting.moderatorShipId, at: deps.clock.now() });
            return told.isOk ? ok(meeting.id) : told;
          }));
          if (!result.isOk) onError?.(fleetId, result.error);
          if (claimed.id === undefined) break;
          tried.push(claimed.id);
        } catch (error) {
          onError?.(fleetId, error);
          if (claimed.id === undefined) break;
          tried.push(claimed.id);
        }
      }
      const next = await deps.meetings.nextEndTime(fleetId);
      if (next !== undefined && (nextAttemptAt === undefined || next < nextAttemptAt)) nextAttemptAt = next;
    }
    return { nextAttemptAt };
  };
}
