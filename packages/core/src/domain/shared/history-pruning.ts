import {
  QUESTION_CONTENT_TYPE,
  type ConsoleSessionId,
  type CredentialId,
  type DeliveryState,
  type EventId,
  type EventType,
  type FleetId,
  type LeaseId,
  type MessageId,
  type ReachRefusalId,
} from '@aeolus-fleet/common';

/**
 * What a fleet's pruning pass may let go (docs/design/retention/retention.md,
 * R2 to R4, R7, R12 and R13): the rules, as plain functions, and the port the pass reads
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
  /** Whether an event of the message or of one of its deliveries is one the newest snapshot has not folded yet (R7). */
  hasUnfoldedEvent: boolean;
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
 * as the schedule does, and a row another transaction holds, or one with an
 * event the snapshot has not folded yet (R7), waits for the next pass.
 */
export function isFinished(candidate: PruneCandidate): boolean {
  if (candidate.isLocked || candidate.hasUnfoldedEvent || candidate.isNamedBySchedule || candidate.meeting === 'open') {
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

/**
 * A crew's session events and its secret's, which name no message or
 * delivery and go by age past the cutoff (R3, Q8). Every other event that
 * names none is a change to the fleet itself, kept for good.
 */
export const CREW_EVENT_TYPES = [
  'ShipClaimed',
  'LeaseRevoked',
  'LeasePushed',
  'ShipReported',
  'TurnReported',
  'StatementSet',
  'CrewStatusChanged',
  'SignInTicketIssued',
  'ViewerSessionStarted',
  'StartingPromptIssued',
  'CredentialRevoked',
] as const satisfies readonly EventType[];

/** How many rows of each kind one batch let go: what its HistoryPruned event says (R9). */
export interface PrunedCounts {
  messages: number;
  deliveries: number;
  events: number;
  overdueDeliveries: number;
  leases: number;
  credentials: number;
  consoleSessions: number;
  noticeDismissals: number;
  guideProgress: number;
  signInTickets: number;
  reachRefusals: number;
}

/** Where the next batch picks up: after the last candidate the last batch read, oldest first. */
export interface PruneCursor {
  createdAt: Date;
  id: MessageId;
}

/** The rows that go by age past the cutoff, whatever messages go (R3, R4, R13). */
export interface AgedRows {
  /** A crew's session and secret events, ones the newest snapshot folded (R3, R7). */
  eventIds: readonly EventId[];
  /** Ended leases no row outside the set names. */
  leaseIds: readonly LeaseId[];
  credentialIds: readonly CredentialId[];
  /** Console sessions ended or expired, which no use renews again; each takes its notice dismissals and guide progress with it. */
  consoleSessionIds: readonly ConsoleSessionId[];
  /** Used or expired sign-in tickets, by their token hash. */
  signInTicketHashes: readonly string[];
  reachRefusalIds: readonly ReachRefusalId[];
}

/** The rows one batch chose, as one set (R16). */
export interface PruneSet extends AgedRows {
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
  /**
   * Up to `limit` rows of each kind that ended, were used or expired, or
   * happened before the cutoff (R3, R4, R13); an ended lease only when no row
   * outside the set, with `messageIds` going, names it.
   */
  agedRows(fleetId: FleetId, input: { cutoff: Date; messageIds: readonly MessageId[]; limit: number }): Promise<AgedRows>;
  /** Makes the set go, children first, taking each message's payload bytes off its day (R6, R16). */
  go(fleetId: FleetId, set: PruneSet): Promise<PrunedCounts>;
  /** Records where the fleet's finished history begins (R9). */
  keepFrom(fleetId: FleetId, at: Date): Promise<void>;
}
