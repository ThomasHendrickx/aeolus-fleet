import type { ComputerSide, DeliveryHistoryEntry, DeliveryState, LeaseEndReason, MessageRecipient, OverdueClock } from '@aeolus-fleet/common';

import { locationKindWord } from '../../../lib/location';
import { undeliverableReason } from '../../../lib/needs-attention';
import { duration } from '../../../lib/relative-time';
import { ship, text, type SentencePart } from '../../../lib/sentence';
import { statusLabel, type PushedStepState } from '../../../components/molecules/status-badge';
import { recipientGroupWords } from '../../../lib/recipient';

/** The StatusBadge of a step of a delivery's way. */
export type DeliveryStepState = DeliveryState | PushedStepState;

const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;

/** Whether the computer side of a pushed ship handed it over, with a number or once more; otherwise a plain receive did (pulled). */
function isPushedHandOver(entry: Pick<DeliveryHistoryEntry, 'handOverNumber' | 'isOnceMore'>): boolean {
  return entry.handOverNumber !== null || entry.isOnceMore;
}

/** The StatusBadge each step of a delivery shows: the state it left the delivery in, or the clock that ran out. */
export function deliveryHistoryState(entry: Pick<DeliveryHistoryEntry, 'type' | 'handOverNumber' | 'isOnceMore'>): DeliveryStepState {
  switch (entry.type) {
    case 'MessageAccepted':
    case 'DeliveryReturned':
      return 'pending';
    case 'DeliveryReceived':
      return 'received';
    case 'DeliveryHanded':
      return isPushedHandOver(entry) ? 'handedPushed' : 'handed';
    case 'DeliveryAcknowledged':
      return 'acknowledged';
    case 'DeliveryHandled':
      return 'handled';
    case 'DeliveryNotHandled':
      return 'notHandled';
    case 'DeliveryOverdue':
      return 'overdue';
    case 'DeliveryUndeliverable':
      return 'undeliverable';
    case 'DeliveryAbandoned':
      return 'abandoned';
    case 'DeliveryDismissed':
      return 'dismissed';
  }
}

/** "+2 s", "+6 min", "+1 h 5 min": how long after the message was stored a step came. */
export function offsetTime(storedAt: Date, at: Date): string {
  const elapsedMs = Math.max(0, at.getTime() - storedAt.getTime());
  return elapsedMs < MINUTE_MS ? `+${String(Math.floor(elapsedMs / SECOND_MS))} s` : `+${duration(storedAt, at)}`;
}

/** "the trierarch on mac-mini", "the plugin watcher", "the gateway": the computer side of a pushed ship, a trierarch by its computer. */
export function computerSideWords(side: ComputerSide): string {
  switch (side.kind) {
    case 'trierarch':
      return `the trierarch on ${side.trierarch.name}`;
    case 'pluginWatcher':
      return 'the plugin watcher';
    case 'personApp':
      return "the person's app";
    case 'gateway':
      return 'the gateway';
    case 'adapter':
      return 'the adapter';
  }
}

/** ", session on hetzner-1": where the session it was handed to ran, its description when it gave one. */
function sessionOn(location: DeliveryHistoryEntry['location']): SentencePart[] {
  if (location === null) {
    return [];
  }
  const where =
    location.description !== null && location.description !== '' ? location.description : locationKindWord(location.kind);
  return [text(`, session on ${where}`)];
}

/** The ship the entry names, or nothing when it names none. */
function shipOf(entry: DeliveryHistoryEntry): SentencePart[] {
  return entry.ship ? [ship(entry.ship)] : [text('a ship')];
}

/** " by the plugin watcher", or nothing when the step names no computer side. */
function byWhom(entry: DeliveryHistoryEntry): SentencePart[] {
  return entry.by ? [text(` by ${computerSideWords(entry.by)}`)] : [];
}

/** Which clock ran out: "handed 10 min, not confirmed" or "waiting 60 min, session busy". */
export function overdueWords(overdue: { clock: OverdueClock; minutes: number }): string {
  const after = `${String(overdue.minutes)} min`;
  switch (overdue.clock) {
    case 'notConfirmed':
      return `handed ${after}, not confirmed`;
    case 'idle':
      return `waiting ${after}, session idle`;
    case 'busy':
      return `waiting ${after}, session busy`;
  }
}

/** Why the lease that held it ended, from its ship's side. */
function leaseEndParts(reason: LeaseEndReason, entry: DeliveryHistoryEntry): SentencePart[] {
  switch (reason) {
    case 'released':
      return [...shipOf(entry), text(' was released')];
    case 'retired':
      return [...shipOf(entry), text(' was retired')];
    case 'deregistered':
      return [text('the session of '), ...shipOf(entry), text(' deregistered')];
    case 'takenOver':
      return [text('a new console session took over')];
    case 'signedOut':
      return [text('the operator signed out')];
    case 'passwordReset':
      return [text('the operator password was reset')];
    case 'accountCutOff':
      return [text('the account signed in as argo was cut off')];
  }
}

function returned(entry: DeliveryHistoryEntry, read: { recipient: MessageRecipient; older: DeliveryHistoryEntry | undefined }): SentencePart[] {
  const back = read.recipient.kind === 'ship' ? 'Back in the inbox: ' : 'Returned to the queue: ';
  if (entry.leaseEnd === null) {
    return [text(back), text('the session of '), ...shipOf(entry), text(' ended before acknowledging it.')];
  }
  const was = read.older ? ` (was ${statusLabel(deliveryHistoryState(read.older)).toLowerCase()})` : '';
  return [text(back), ...leaseEndParts(entry.leaseEnd, entry), text(`${was}.`)];
}

function handed(entry: DeliveryHistoryEntry): SentencePart[] {
  if (!isPushedHandOver(entry)) {
    const attempt = entry.attempts !== null && entry.attempts > 1 ? `Attempt ${String(entry.attempts)}: handed (pulled)` : 'Handed (pulled)';
    return [text(`${attempt} to `), ...shipOf(entry), ...sessionOn(entry.location), text('.')];
  }
  const number = entry.handOverNumber === null ? '' : ` (no. ${String(entry.handOverNumber)})`;
  return entry.isOnceMore
    ? [text('Handed once more to '), ...shipOf(entry), text(`${number}: its turn died.`)]
    : [text('Handed to '), ...shipOf(entry), text(number), ...byWhom(entry), ...(entry.channel === null ? [] : [text(` via ${entry.channel}`)]), text('.')];
}

/** "Handed 4 times, never confirmed; fifth refused: undeliverable.": a pushed one counts hand-overs, a pulled one receives. */
function undeliverable(entry: DeliveryHistoryEntry): string {
  if (entry.attempts === null) {
    return 'Never acknowledged: no ship takes it automatically any more.';
  }
  return undeliverableReason({ attempts: entry.attempts, isPushed: entry.handOverNumber !== null });
}

/**
 * The one sentence of a step of a delivery's way
 * (docs/design/png/DeliveryHistory.png), naming who held it and, on a pushed
 * ship, the computer side that took it. The recipient says whether the
 * delivery waits in one ship's inbox or in its type's queue; the step before
 * it says what a return to pending ended.
 */
export function deliveryHistorySentence(
  entry: DeliveryHistoryEntry,
  read: { recipient: MessageRecipient; older?: DeliveryHistoryEntry | undefined },
): SentencePart[] {
  const { recipient, older } = read;
  switch (entry.type) {
    case 'MessageAccepted':
      return recipient.kind === 'ship'
        ? [text('Stored in the inbox of '), ship(recipient.ship), text('.')]
        : [text(`Queued for ${recipientGroupWords(recipient)}.`)];
    case 'DeliveryReceived':
      return [text(entry.isAgain ? 'Received again' : 'Received'), ...byWhom(entry), text(' for '), ...shipOf(entry), text('.')];
    case 'DeliveryHanded':
      return handed(entry);
    case 'DeliveryReturned':
      return returned(entry, { recipient, older });
    case 'DeliveryAcknowledged':
      return [text('Acknowledged by '), ...shipOf(entry), text('.')];
    case 'DeliveryHandled':
      return [text('Handled by '), ...shipOf(entry), text(': its turn ended.')];
    case 'DeliveryNotHandled':
      return [text('Not handled: the turn of '), ...shipOf(entry), text(' died twice.')];
    case 'DeliveryOverdue':
      return [text(entry.overdue ? `argo told: ${overdueWords(entry.overdue)}.` : 'argo told: overdue.')];
    case 'DeliveryUndeliverable':
      return [text(undeliverable(entry))];
    case 'DeliveryAbandoned':
      return [text('Abandoned: '), ...shipOf(entry), text(' was retired before taking it.')];
    case 'DeliveryDismissed':
      return [text('Dismissed by the operator: no ship takes it any more.')];
  }
}
