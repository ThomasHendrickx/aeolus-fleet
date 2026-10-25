/**
 * The pruning pass's port over the in-memory state: each fleet's last pass
 * and where its history begins, the candidates in Postgres's order, and the
 * one step that makes a set go. A test marks a fleet's prune lock, or a
 * message's rows, as held by another transaction.
 */
import { ANSWER_CONTENT_TYPE, type FleetId } from '@aeolus-fleet/common';

import type { ClaimingLease, HistoryPruner, PruneCandidate } from '../../src/domain/shared/history-pruning.js';
import type { Delivery, Message } from '../../src/domain/messaging/message.js';
import type { InMemoryState } from './in-memory.js';

/** The mic and participant events of a meeting, which go once it ended before the cutoff (R12). */
const MEETING_PART_TYPES: readonly string[] = [
  'ParticipantAdded',
  'ParticipantLeft',
  'ParticipantRejoined',
  'ParticipantRevoked',
  'MicRequested',
  'MicRequestWithdrawn',
  'MicGiven',
  'MicReleased',
  'MicTaken',
  'MicPatternSet',
];

function byAge(first: Message, second: Message): number {
  return first.createdAt.getTime() - second.createdAt.getTime() || first.id.localeCompare(second.id);
}

export function createInMemoryHistoryPruner(state: InMemoryState): HistoryPruner {
  const pruneOf = (fleetId: FleetId) => {
    const held = state.fleetPrunes.find((row) => row.fleetId === fleetId);
    if (held) {
      return held;
    }
    const row = { fleetId, prunedAt: null, keptFrom: null };
    state.fleetPrunes.push(row);
    return row;
  };

  const claimingLease = (delivery: Delivery): ClaimingLease => {
    const lease = state.leases.find((held) => held.fleetId === delivery.fleetId && held.id === delivery.claimedByLeaseId);
    if (lease === undefined) {
      return 'none';
    }
    if (lease.endedAt !== null) {
      return 'ended';
    }
    return state.pushedLeases.some((pushed) => pushed.leaseId === lease.id) ? 'openPushed' : 'open';
  };

  /** Whether an event of the message or its deliveries comes after the newest snapshot's fold, numbered as the in-memory snapshot numbers them. */
  const hasUnfoldedEvent = (message: Message): boolean => {
    const newest = state.healthSnapshots.filter((row) => row.fleetId === message.fleetId).toSorted((first, second) => second.hour.getTime() - first.hour.getTime())[0];
    const foldedSeq = newest?.fold.seq ?? 0;
    const deliveryIds = state.deliveries.filter((delivery) => delivery.fleetId === message.fleetId && delivery.messageId === message.id).map((delivery) => delivery.id);
    return state.events
      .filter((event) => event.fleetId === message.fleetId)
      .some((event, index) => index + 1 > foldedSeq && (event.messageId === message.id || (event.deliveryId !== undefined && deliveryIds.includes(event.deliveryId))));
  };

  const candidateOf = (message: Message): PruneCandidate => {
    const meeting = message.meetingId === null ? undefined : state.meetings.find((held) => held.fleetId === message.fleetId && held.id === message.meetingId);
    return {
      id: message.id,
      createdAt: message.createdAt,
      contentType: message.contentType,
      isAnswered: state.messages.some((reply) => reply.fleetId === message.fleetId && reply.inReplyToMessageId === message.id && reply.contentType === ANSWER_CONTENT_TYPE),
      meeting: meeting === undefined ? 'none' : meeting.endedAt === null ? 'open' : 'ended',
      isNamedBySchedule: state.schedules.some(
        (schedule) =>
          schedule.fleetId === message.fleetId &&
          (schedule.send.inReplyTo === message.id || (schedule.lastOutcome?.kind === 'sent' && schedule.lastOutcome.messageId === message.id)),
      ),
      isLocked: state.lockedMessages.includes(message.id),
      hasUnfoldedEvent: hasUnfoldedEvent(message),
      deliveries: state.deliveries
        .filter((delivery) => delivery.fleetId === message.fleetId && delivery.messageId === message.id)
        .map((delivery) => ({ state: delivery.state, claimingLease: claimingLease(delivery) })),
    };
  };

  return {
    claimPass: (fleetId, { at, dueBefore }) => {
      const row = pruneOf(fleetId);
      if (row.prunedAt !== null && row.prunedAt > dueBefore) {
        return Promise.resolve(false);
      }
      row.prunedAt = at;
      return Promise.resolve(true);
    },
    newestSnapshotHour: (fleetId) =>
      Promise.resolve(
        state.healthSnapshots
          .filter((row) => row.fleetId === fleetId)
          .map((row) => row.hour)
          .toSorted((first, second) => second.getTime() - first.getTime())
          .at(0),
      ),
    tryLock: (fleetId) => Promise.resolve(!state.historyPruneLocks.includes(fleetId)),
    candidates: (fleetId, { cutoff, after, limit }) =>
      Promise.resolve(
        state.messages
          .filter((message) => message.fleetId === fleetId && message.createdAt < cutoff)
          .toSorted(byAge)
          .filter((message) => after === null || message.createdAt > after.createdAt || (message.createdAt.getTime() === after.createdAt.getTime() && message.id > after.id))
          .slice(0, limit)
          .map(candidateOf),
      ),
    meetingEvents: (fleetId, { cutoff, limit }) =>
      Promise.resolve(
        state.events
          .filter((event) => {
            const meetingId = event.details.meetingId;
            const meeting = state.meetings.find((held) => held.fleetId === fleetId && held.id === meetingId);
            return event.fleetId === fleetId && MEETING_PART_TYPES.includes(event.type) && meeting?.endedAt != null && meeting.endedAt < cutoff;
          })
          .slice(0, limit)
          .map((event) => event.id),
      ),
    go: (fleetId, set) => {
      const deliveryIds = state.deliveries.filter((delivery) => delivery.fleetId === fleetId && set.messageIds.includes(delivery.messageId)).map((delivery) => delivery.id);
      const goes = <T>(rows: T[], isGoing: (row: T) => boolean): number => {
        const kept = rows.filter((row) => !isGoing(row));
        const gone = rows.length - kept.length;
        rows.splice(0, rows.length, ...kept);
        return gone;
      };
      const events = goes(
        state.events,
        (event) =>
          event.fleetId === fleetId &&
          ((event.messageId !== undefined && set.messageIds.includes(event.messageId)) ||
            (event.deliveryId !== undefined && deliveryIds.includes(event.deliveryId)) ||
            set.meetingEventIds.includes(event.id)),
      );
      const overdueDeliveries = goes(state.overdueDeliveries, (row) => row.fleetId === fleetId && deliveryIds.includes(row.deliveryId));
      goes(state.deliveryReads, (row) => row.fleetId === fleetId && deliveryIds.includes(row.deliveryId));
      const deliveries = goes(state.deliveries, (delivery) => delivery.fleetId === fleetId && deliveryIds.includes(delivery.id));
      const messages = goes(state.messages, (message) => message.fleetId === fleetId && set.messageIds.includes(message.id));
      return Promise.resolve({ messages, deliveries, events, overdueDeliveries });
    },
    keepFrom: (fleetId, at) => {
      pruneOf(fleetId).keptFrom = at;
      return Promise.resolve();
    },
  };
}
