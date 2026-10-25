import { QUESTION_CONTENT_TYPE, type DeliveryState, type EventId, type FleetId, type MessageId } from '@aeolus-fleet/common';

/**
 * What a fleet's pruning pass may let go (docs/design/retention/retention.md,
 * R2, R7 and R12): the rules, as plain functions, and the port the pass reads
 * and prunes through. The port's query only offers messages its own filter
 * finds finished; these rules decide again on the rows it locked, so a row
 * that changed or was skipped as locked stays.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where a delivery's claiming lease stands: whether a re-read of an acknowledged delivery can still come (L2). */
export type ClaimingLease = 'none' | 'ended' | 'open' | 'openPushed';

/** One delivery of a candidate message, as its locked row stands. */
export interface CandidateDelivery {
  state: DeliveryState;
  claimingLease: ClaimingLease;
}

/** A message older than the cutoff that the port offers, with what decides whether it is finished. */
export interface PruneCandidate {
  id: MessageId;
  createdAt: Date;
  contentType: string;
  /** Whether a reply of the answer content type names it. */
  isAnswered: boolean;
  /** The meeting it was sent to or is the added notice of: none, not ended, or ended. */
  meeting: 'none' | 'open' | 'ended';
  /** Whether a schedule names it, as its in-reply-to or its last sent message: a kept row names it. */
  isNamedBySchedule: boolean;
  /** Whether the message or one of its deliveries was locked by another transaction and skipped. */
  isLocked: boolean;
  deliveries: readonly CandidateDelivery[];
}

/**
 * Final: handled, dismissed, abandoned, or acknowledged where no re-read can
 * come, its claiming lease ended or never pushed (R2). Pending, received,
 * handed, undeliverable and not handled never are (L1, L2).
 */
export function isFinalDelivery(delivery: CandidateDelivery): boolean {
  switch (delivery.state) {
    case 'handled':
    case 'dismissed':
    case 'abandoned':
      return true;
    case 'acknowledged':
      return delivery.claimingLease !== 'openPushed';
    case 'pending':
    case 'received':
    case 'handed':
    case 'notHandled':
    case 'undeliverable':
      return false;
  }
}

/**
 * A message is finished when every delivery of it is final, and it is not an
 * open question (L6, L21; a withdrawn or replaced one too, R15) or a
 * contribution to a meeting not ended (R2); a message a schedule names stays,
 * as the schedule does, and a row another transaction holds waits for the
 * next pass.
 */
export function isFinished(candidate: PruneCandidate): boolean {
  if (candidate.isLocked || candidate.isNamedBySchedule || candidate.meeting === 'open') {
    return false;
  }
  if (candidate.contentType === QUESTION_CONTENT_TYPE && !candidate.isAnswered) {
    return false;
  }
  return candidate.deliveries.every(isFinalDelivery);
}

/**
 * The cutoff: now minus the fleet's retention, never later than the hour of
 * its newest stuck snapshot, so no event the snapshot has not folded goes
 * (R7, L9).
 */
export function pruningCutoff(input: { now: Date; retentionDays: number; newestSnapshotHour: Date }): Date {
  const byRetention = input.now.getTime() - input.retentionDays * DAY_MS;
  return new Date(Math.min(byRetention, input.newestSnapshotHour.getTime()));
}

/** How many rows of each kind one batch let go: what its HistoryPruned event says (R9). */
export interface PrunedCounts {
  messages: number;
  deliveries: number;
  events: number;
  overdueDeliveries: number;
}

/** Where the next batch picks up: after the last candidate the last batch read, oldest first. */
export interface PruneCursor {
  createdAt: Date;
  id: MessageId;
}

/** The rows one batch chose, as one set (R16). */
export interface PruneSet {
  messageIds: readonly MessageId[];
  /** The mic and participant events of meetings ended before the cutoff (R12). */
  meetingEventIds: readonly EventId[];
}

/** Outbound port: the pruning pass's reads and its one step that makes a set go, in the batch's unit of work. */
export interface HistoryPruner {
  /** Marks the fleet's pass as run at `at` when its last ran at or before `dueBefore`, or never; false when another pass ran since. */
  claimPass(fleetId: FleetId, input: { at: Date; dueBefore: Date }): Promise<boolean>;
  /** The hour of the fleet's newest stuck snapshot; none before its first. */
  newestSnapshotHour(fleetId: FleetId): Promise<Date | undefined>;
  /** The fleet's prune lock, for this unit of work, taken with try: false when another server holds it. */
  tryLock(fleetId: FleetId): Promise<boolean>;
  /** Up to `limit` messages created before the cutoff and after the cursor, oldest first, each row locked or marked locked. */
  candidates(fleetId: FleetId, input: { cutoff: Date; after: PruneCursor | null; limit: number }): Promise<PruneCandidate[]>;
  /** Up to `limit` mic and participant events of meetings ended before the cutoff. */
  meetingEvents(fleetId: FleetId, input: { cutoff: Date; limit: number }): Promise<EventId[]>;
  /** Makes the set go, children first, taking each message's payload bytes off its day (R6, R16). */
  go(fleetId: FleetId, set: PruneSet): Promise<PrunedCounts>;
  /** Records where the fleet's finished history begins (R9). */
  keepFrom(fleetId: FleetId, at: Date): Promise<void>;
}
