/** D8: one transaction acknowledges outstanding contribution deliveries through a meeting contribution. */
import type { IdGenerator, MeetingId, MessageId } from '@aeolus-fleet/common';

import { holdLease, type HoldLeaseTx, type LeaseEnded } from '../registry/public.js';
import { actorOf, type Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import type { EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { checkMeetingReadUpTo } from './meeting-read.js';
import type { DeliveryRepository, MeetingRepository, MessageRepository } from './ports.js';

export interface AcknowledgeMeetingUpToTx extends HoldLeaseTx {
  meetings: Pick<MeetingRepository, 'findForNoKeyUpdate'>;
  messages: Pick<MessageRepository, 'find'>;
  deliveries: Pick<DeliveryRepository, 'acknowledgeMeetingContributionsUpTo'>;
  events: EventLog;
}
export type AcknowledgeMeetingUpToRefusal = DomainError<'MEETING_NOT_FOUND' | 'MESSAGE_NOT_FOUND'> | LeaseEnded;
export type AcknowledgeMeetingUpTo = (crew: Crew, input: { meetingId: MeetingId; messageId: MessageId }) => Promise<Result<{ acknowledged: number }, AcknowledgeMeetingUpToRefusal>>;

/** The meeting lock precedes the lease and deliveries, as a contribution and a retire do. */
export function createAcknowledgeMeetingUpTo(deps: { uow: UnitOfWork<AcknowledgeMeetingUpToTx>; clock: Clock; ids: IdGenerator }): AcknowledgeMeetingUpTo {
  return (crew, input) => deps.uow.run(async (tx): Promise<Result<{ acknowledged: number }, AcknowledgeMeetingUpToRefusal>> => {
    const meeting = await tx.meetings.findForNoKeyUpdate(crew.fleetId, input.meetingId);
    const held = await holdLease(tx, crew);
    if (!held.isOk) return held;
    const message = await tx.messages.find(crew.fleetId, input.messageId);
    const checked = checkMeetingReadUpTo({ meeting, message, shipId: crew.shipId, ...input });
    if (!checked.isOk) return checked;
    const eventId = deps.ids('event');
    const acknowledged = await tx.deliveries.acknowledgeMeetingContributionsUpTo({ fleetId: crew.fleetId, meetingId: input.meetingId, shipId: crew.shipId, leaseId: crew.leaseId, upTo: input.messageId, eventId });
    if (acknowledged > 0) {
      await tx.events.append({ id: eventId, fleetId: crew.fleetId, type: 'MeetingReadUpTo', occurredAt: deps.clock.now(), actor: actorOf(crew), shipId: crew.shipId, messageId: input.messageId, details: { meetingId: input.meetingId, upTo: input.messageId, acknowledged, leaseId: crew.leaseId } });
    }
    return ok({ acknowledged });
  });
}
