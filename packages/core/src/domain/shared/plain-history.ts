/**
 * The history reads' payloads made plain (decision 0068, B9): what the
 * history port reads as stored, sealed in a sealed fleet, is unsealed with
 * the data keys of the whole page, each unwrapped once, outside any unit of
 * work. These reads claim nothing: a read of one payload refuses
 * KEY_UNAVAILABLE for a key that cannot be had; a read that lists several
 * marks each payload it cannot unseal unreadable and lists the rest.
 */
import type { FleetId, MessageId } from '@aeolus-fleet/common';

import { heldForList, heldForRead, listedUnsealed, plainForRead, UNREADABLE_PAYLOAD, type HeldDataKeys, type ListedPayload, type PayloadSealing, type StoredPayload } from '../messaging/public.js';
import type { DomainError } from './errors.js';
import type { InboxEntry, NeedsAttentionEntry } from './history.js';
import { ok, type Result } from './result.js';

/** The fleet whose payloads a read unseals, and what it unseals them with. */
export interface PlainHistoryOf {
  sealing: PayloadSealing;
  fleetId: FleetId;
}

export type WithPlainPayload<T extends { payload: StoredPayload }> = Omit<T, 'payload'> & { payload: string };

export type WithListedPayload<T extends { payload: StoredPayload }> = Omit<T, 'payload'> & { payload: ListedPayload };

/** The message with its payload plain. */
export async function plainMessage<T extends { id: MessageId; payload: StoredPayload }>(of: PlainHistoryOf, message: T): Promise<Result<WithPlainPayload<T>, DomainError<'KEY_UNAVAILABLE'>>> {
  const held = await heldForRead(of, [message.payload]);
  if (!held.isOk) {
    return held;
  }
  const payload = plainForRead(held.value, { row: { fleetId: of.fleetId, rowId: message.id }, payload: message.payload });
  return payload.isOk ? ok({ ...message, payload: payload.value }) : payload;
}

/** Each message with its payload plain or marked unreadable, in the same order. */
export async function listedMessages<T extends { id: MessageId; payload: StoredPayload }>(of: PlainHistoryOf, messages: readonly T[]): Promise<WithListedPayload<T>[]> {
  const held = await heldForList(of, messages.map(({ payload }) => payload));
  return messages.map((message) => ({ ...message, payload: listedOf(held, { fleetId: of.fleetId, stored: message }) }));
}

/** Each Needs attention entry with its message's payload plain or marked unreadable, in the same order. */
export async function listedNeedsAttention(of: PlainHistoryOf, entries: readonly NeedsAttentionEntry<StoredPayload>[]): Promise<NeedsAttentionEntry<ListedPayload>[]> {
  const held = await heldForList(of, entries.map(({ message }) => message.payload));
  return entries.map((entry) => ({ ...entry, message: { ...entry.message, payload: listedOf(held, { fleetId: of.fleetId, stored: entry.message }) } }));
}

/** Each inbox entry with its message's payload and its replies' plain or marked unreadable, in the same order. */
export async function listedInboxEntries(of: PlainHistoryOf, entries: readonly InboxEntry<StoredPayload>[]): Promise<InboxEntry<ListedPayload>[]> {
  const held = await heldForList(of, entries.flatMap(({ message, replies }) => [message.payload, ...replies.map(({ payload }) => payload)]));
  const listed = (stored: { id: MessageId; payload: StoredPayload }) => listedOf(held, { fleetId: of.fleetId, stored });
  return entries.map((entry) => ({
    ...entry,
    replies: entry.replies.map((reply) => ({ ...reply, payload: listed(reply) })),
    message: { ...entry.message, payload: listed(entry.message) },
  }));
}

function listedOf(held: HeldDataKeys, of: { fleetId: FleetId; stored: { id: MessageId; payload: StoredPayload } }): ListedPayload {
  const listed = listedUnsealed(held, { row: { fleetId: of.fleetId, rowId: of.stored.id }, payload: of.stored.payload });
  // heldForList unwrapped every key these payloads name, or holds it unreachable: one still needed is never met.
  return listed.isOk ? listed.value : UNREADABLE_PAYLOAD;
}
