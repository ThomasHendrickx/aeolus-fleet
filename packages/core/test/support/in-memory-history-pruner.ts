/**
 * The pruning pass's port over the in-memory state: each fleet's last pass
 * and where its history begins, the candidates in Postgres's order, and the
 * rows that go by age, and the one step that makes a set go. A test marks a fleet's prune lock, or a
 * message's rows, as held by another transaction.
 */
import { ANSWER_CONTENT_TYPE, type FleetId } from '@aeolus-fleet/common';

import { CREW_EVENT_TYPES, type ClaimingLease, type HistoryPruner, type PruneCandidate } from '../../src/domain/shared/history-pruning.js';
import type { ConsoleSignIn } from '../../src/domain/identity/notice.js';
import type { Delivery, Message } from '../../src/domain/messaging/message.js';
import { numberedEvents, type InMemoryState } from './in-memory.js';

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

const CREW_EVENTS: readonly string[] = CREW_EVENT_TYPES;

function sessionOf(signIn: ConsoleSignIn): string | undefined {
  return signIn.kind === 'account' ? undefined : signIn.consoleSessionId;
}

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

  /** The newest snapshot's fold. */
  const foldedSeqOf = (fleetId: FleetId): number =>
    state.healthSnapshots.filter((row) => row.fleetId === fleetId).toSorted((first, second) => second.hour.getTime() - first.hour.getTime())[0]?.fold.seq ?? 0;

  /** Whether an event of the message or its deliveries comes after the newest snapshot's fold. */
  const hasUnfoldedEvent = (message: Message): boolean => {
    const foldedSeq = foldedSeqOf(message.fleetId);
    const deliveryIds = state.deliveries.filter((delivery) => delivery.fleetId === message.fleetId && delivery.messageId === message.id).map((delivery) => delivery.id);
    return numberedEvents(state, message.fleetId).some(
      (event) => event.seq > foldedSeq && (event.messageId === message.id || (event.deliveryId !== undefined && deliveryIds.includes(event.deliveryId))),
    );
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
    agedRows: (fleetId, { cutoff, messageIds, limit }) => {
      const foldedSeq = foldedSeqOf(fleetId);
      const eventIds = numberedEvents(state, fleetId)
        .filter(
          (event) => event.seq <= foldedSeq && CREW_EVENTS.includes(event.type) && event.occurredAt < cutoff && event.messageId === undefined && event.deliveryId === undefined,
        )
        .slice(0, limit)
        .map((event) => event.id);
      const consoleSessionIds = state.consoleSessions
        .filter((session) => session.fleetId === fleetId && ((session.endedAt !== null && session.endedAt < cutoff) || session.expiresAt < cutoff))
        .slice(0, limit)
        .map((session) => session.id);
      const keptDeliveries = state.deliveries.filter((delivery) => delivery.fleetId === fleetId && !messageIds.includes(delivery.messageId));
      const keptDeliveryIds = keptDeliveries.map((delivery) => delivery.id);
      const leaseIds = state.leases
        .filter(
          (lease) =>
            lease.fleetId === fleetId &&
            lease.endedAt !== null &&
            lease.endedAt < cutoff &&
            !keptDeliveries.some((delivery) => delivery.claimedByLeaseId === lease.id) &&
            !state.overdueDeliveries.some((row) => row.fleetId === fleetId && row.leaseId === lease.id && keptDeliveryIds.includes(row.deliveryId)) &&
            !state.consoleSessions.some((session) => session.fleetId === fleetId && session.leaseId === lease.id && !consoleSessionIds.includes(session.id)),
        )
        .slice(0, limit)
        .map((lease) => lease.id);
      const credentialIds = state.credentials
        .filter((credential) => credential.fleetId === fleetId && credential.invalidatedAt !== null && credential.invalidatedAt < cutoff)
        .slice(0, limit)
        .map((credential) => credential.id);
      const signInTicketHashes = state.signInTickets
        .filter((ticket) => ticket.fleetId === fleetId && ((ticket.usedAt !== null && ticket.usedAt < cutoff) || ticket.expiresAt < cutoff))
        .slice(0, limit)
        .map((ticket) => ticket.tokenHash);
      const reachRefusalIds = state.reachRefusals
        .filter((refusal) => refusal.fleetId === fleetId && refusal.at < cutoff)
        .slice(0, limit)
        .map((refusal) => refusal.id);
      return Promise.resolve({ eventIds, leaseIds, credentialIds, consoleSessionIds, signInTicketHashes, reachRefusalIds });
    },
    go: (fleetId, set) => {
      const deliveryIds = state.deliveries.filter((delivery) => delivery.fleetId === fleetId && set.messageIds.includes(delivery.messageId)).map((delivery) => delivery.id);
      const goes = <T>(rows: T[], isGoing: (row: T) => boolean): number => {
        const kept = rows.filter((row) => !isGoing(row));
        const gone = rows.length - kept.length;
        rows.splice(0, rows.length, ...kept);
        return gone;
      };
      const isGoingEvent = (event: (typeof state.events)[number]) =>
        event.fleetId === fleetId &&
        ((event.messageId !== undefined && set.messageIds.includes(event.messageId)) ||
          (event.deliveryId !== undefined && deliveryIds.includes(event.deliveryId)) ||
          set.meetingEventIds.includes(event.id) ||
          set.eventIds.includes(event.id));
      for (const event of numberedEvents(state, fleetId).filter(isGoingEvent)) {
        state.prunedEventSeqs.push({ fleetId, seq: event.seq });
      }
      const events = goes(state.events, isGoingEvent);
      const overdueDeliveries = goes(state.overdueDeliveries, (row) => row.fleetId === fleetId && deliveryIds.includes(row.deliveryId));
      goes(state.deliveryReads, (row) => row.fleetId === fleetId && deliveryIds.includes(row.deliveryId));
      const deliveries = goes(state.deliveries, (delivery) => delivery.fleetId === fleetId && deliveryIds.includes(delivery.id));
      const messages = goes(state.messages, (message) => message.fleetId === fleetId && set.messageIds.includes(message.id));
      const isGoingSession = (row: { fleetId: FleetId; signIn: ConsoleSignIn }) => {
        const sessionId = sessionOf(row.signIn);
        return row.fleetId === fleetId && sessionId !== undefined && set.consoleSessionIds.some((id) => id === sessionId);
      };
      const noticeDismissals = goes(state.noticeDismissals, isGoingSession);
      const guideProgress = goes(state.guideProgress, isGoingSession);
      const consoleSessions = goes(state.consoleSessions, (session) => session.fleetId === fleetId && set.consoleSessionIds.includes(session.id));
      const isGoingLease = (row: { fleetId: FleetId; leaseId: string }) => row.fleetId === fleetId && set.leaseIds.some((id) => id === row.leaseId);
      for (const rows of [state.pushedLeases, state.leaseSeen, state.leaseReports, state.leaseStatements, state.leaseTurns]) {
        goes<{ fleetId: FleetId; leaseId: string }>(rows, isGoingLease);
      }
      const leases = goes(state.leases, (lease) => lease.fleetId === fleetId && set.leaseIds.includes(lease.id));
      const credentials = goes(state.credentials, (credential) => credential.fleetId === fleetId && set.credentialIds.includes(credential.id));
      const signInTickets = goes(state.signInTickets, (ticket) => ticket.fleetId === fleetId && set.signInTicketHashes.includes(ticket.tokenHash));
      const reachRefusals = goes(state.reachRefusals, (refusal) => refusal.fleetId === fleetId && set.reachRefusalIds.includes(refusal.id));
      return Promise.resolve({
        messages,
        deliveries,
        events,
        overdueDeliveries,
        leases,
        credentials,
        consoleSessions,
        noticeDismissals,
        guideProgress,
        signInTickets,
        reachRefusals,
      });
    },
    keepFrom: (fleetId, at) => {
      pruneOf(fleetId).keptFrom = at;
      return Promise.resolve();
    },
  };
}
