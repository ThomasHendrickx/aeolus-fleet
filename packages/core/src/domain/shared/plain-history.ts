/**
 * The history reads' payloads made plain (decision 0068, B9): what the
 * history port reads as stored, sealed in a sealed fleet, is unsealed with
 * the data keys of the whole page, each unwrapped once, outside any unit of
 * work. These reads claim nothing, so a key that cannot be had refuses
 * KEY_UNAVAILABLE.
 */
import type { FleetId, MessageId } from '@aeolus-fleet/common';

import { heldForRead, plainForRead, type HeldDataKeys, type PayloadSealing, type StoredPayload } from '../messaging/public.js';
import type { DomainError } from './errors.js';
import type { InboxEntry, NeedsAttentionEntry } from './history.js';
import { ok, type Result } from './result.js';

/** The fleet whose payloads a read unseals, and what it unseals them with. */
export interface PlainHistoryOf {
  sealing: PayloadSealing;
  fleetId: FleetId;
}

export type WithPlainPayload<T extends { payload: StoredPayload }> = Omit<T, 'payload'> & { payload: string };

/** The message with its payload plain. */
export async function plainMessage<T extends { id: MessageId; payload: StoredPayload }>(of: PlainHistoryOf, message: T): Promise<Result<WithPlainPayload<T>, DomainError<'KEY_UNAVAILABLE'>>> {
  const held = await heldForRead(of, [message.payload]);
  if (!held.isOk) {
    return held;
  }
  const payload = plainForRead(held.value, { row: { fleetId: of.fleetId, rowId: message.id }, payload: message.payload });
  return payload.isOk ? ok({ ...message, payload: payload.value }) : payload;
}

/** Each message with its payload plain, in the same order. */
export async function plainMessages<T extends { id: MessageId; payload: StoredPayload }>(
  of: PlainHistoryOf,
  messages: readonly T[],
): Promise<Result<WithPlainPayload<T>[], DomainError<'KEY_UNAVAILABLE'>>> {
  const held = await heldForRead(of, messages.map(({ payload }) => payload));
  if (!held.isOk) {
    return held;
  }
  const plain: WithPlainPayload<T>[] = [];
  for (const message of messages) {
    const payload = plainForRead(held.value, { row: { fleetId: of.fleetId, rowId: message.id }, payload: message.payload });
    if (!payload.isOk) {
      return payload;
    }
    plain.push({ ...message, payload: payload.value });
  }
  return ok(plain);
}

/** Each Needs attention entry with its message's payload plain, in the same order. */
export async function plainNeedsAttention(of: PlainHistoryOf, entries: readonly NeedsAttentionEntry<StoredPayload>[]): Promise<Result<NeedsAttentionEntry[], DomainError<'KEY_UNAVAILABLE'>>> {
  const held = await heldForRead(of, entries.map(({ message }) => message.payload));
  if (!held.isOk) {
    return held;
  }
  const plain: NeedsAttentionEntry[] = [];
  for (const entry of entries) {
    const payload = plainForRead(held.value, { row: { fleetId: of.fleetId, rowId: entry.message.id }, payload: entry.message.payload });
    if (!payload.isOk) {
      return payload;
    }
    plain.push({ ...entry, message: { ...entry.message, payload: payload.value } });
  }
  return ok(plain);
}

/** The inbox entry with its message's payload and its replies' plain. */
export async function plainInboxEntry(of: PlainHistoryOf, entry: InboxEntry<StoredPayload>): Promise<Result<InboxEntry, DomainError<'KEY_UNAVAILABLE'>>> {
  const held = await heldForRead(of, payloadsOf(entry));
  return held.isOk ? inboxEntryWith(held.value, { fleetId: of.fleetId, entry }) : held;
}

/** Each inbox entry with its message's payload and its replies' plain, in the same order. */
export async function plainInboxEntries(of: PlainHistoryOf, entries: readonly InboxEntry<StoredPayload>[]): Promise<Result<InboxEntry[], DomainError<'KEY_UNAVAILABLE'>>> {
  const held = await heldForRead(of, entries.flatMap(payloadsOf));
  if (!held.isOk) {
    return held;
  }
  const plain: InboxEntry[] = [];
  for (const entry of entries) {
    const unsealed = inboxEntryWith(held.value, { fleetId: of.fleetId, entry });
    if (!unsealed.isOk) {
      return unsealed;
    }
    plain.push(unsealed.value);
  }
  return ok(plain);
}

function payloadsOf({ message, replies }: InboxEntry<StoredPayload>): StoredPayload[] {
  return [message.payload, ...replies.map(({ payload }) => payload)];
}

function inboxEntryWith(held: HeldDataKeys, of: { fleetId: FleetId; entry: InboxEntry<StoredPayload> }): Result<InboxEntry, DomainError<'KEY_UNAVAILABLE'>> {
  const { fleetId, entry } = of;
  const plainOf = (stored: { id: MessageId; payload: StoredPayload }) => plainForRead(held, { row: { fleetId, rowId: stored.id }, payload: stored.payload });
  const payload = plainOf(entry.message);
  if (!payload.isOk) {
    return payload;
  }
  const replies: InboxEntry['replies'] = [];
  for (const reply of entry.replies) {
    const replyPayload = plainOf(reply);
    if (!replyPayload.isOk) {
      return replyPayload;
    }
    replies.push({ ...reply, payload: replyPayload.value });
  }
  return ok({ ...entry, replies, message: { ...entry.message, payload: payload.value } });
}
