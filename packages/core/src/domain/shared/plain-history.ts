/**
 * The history reads' payloads made plain (decision 0068, B9): what the
 * history port reads as stored, sealed in a sealed fleet, is unsealed with
 * the data keys of the whole page, each unwrapped once, outside any unit of
 * work. These reads claim nothing: each payload they cannot unseal is
 * marked unreadable and the rest answered, and a message's page keeps its
 * envelope and delivery. Each message says whether its payload is sealed,
 * for the console to mark it (N1); one stored before sealing that the
 * sealing pass has not sealed yet is not.
 */
import type { FleetId, MessageId } from '@aeolus-fleet/common';

import { heldForList, isSealedPayload, listedUnsealed, UNREADABLE_PAYLOAD, type HeldDataKeys, type ListedPayload, type PayloadSealing, type StoredPayload } from '../messaging/public.js';
import type { InboxEntry, NeedsAttentionEntry } from './history.js';

/** The fleet whose payloads a read unseals, and what it unseals them with. */
export interface PlainHistoryOf {
  sealing: PayloadSealing;
  fleetId: FleetId;
}

/** A message as a read answers it: its payload plain or marked unreadable, and whether it is sealed. */
export type WithListedPayload<T extends { payload: StoredPayload }> = Omit<T, 'payload'> & { payload: ListedPayload; isPayloadSealed: boolean };

/** An inbox entry as the inbox reads answer it: its message's payload and its replies' plain or marked unreadable, the message saying whether it is sealed. */
export type ListedInboxEntry = Omit<InboxEntry<ListedPayload>, 'message'> & { message: InboxEntry<ListedPayload>['message'] & { isPayloadSealed: boolean } };

/** The message with its payload plain or marked unreadable. */
export async function listedMessage<T extends { id: MessageId; payload: StoredPayload }>(of: PlainHistoryOf, message: T): Promise<WithListedPayload<T>> {
  const held = await heldForList(of, [message.payload]);
  return listedPayloadOf(held, { fleetId: of.fleetId, message });
}

/** Each message with its payload plain or marked unreadable, in the same order. */
export async function listedMessages<T extends { id: MessageId; payload: StoredPayload }>(of: PlainHistoryOf, messages: readonly T[]): Promise<WithListedPayload<T>[]> {
  const held = await heldForList(of, messages.map(({ payload }) => payload));
  return messages.map((message) => listedPayloadOf(held, { fleetId: of.fleetId, message }));
}

/** Each Needs attention entry with its message's payload plain or marked unreadable, in the same order. */
export async function listedNeedsAttention(of: PlainHistoryOf, entries: readonly NeedsAttentionEntry<StoredPayload>[]): Promise<NeedsAttentionEntry<ListedPayload>[]> {
  const held = await heldForList(of, entries.map(({ message }) => message.payload));
  return entries.map((entry) => ({ ...entry, message: { ...entry.message, payload: listedOf(held, { fleetId: of.fleetId, stored: entry.message }) } }));
}

/** Each inbox entry with its message's payload and its replies' plain or marked unreadable, in the same order. */
export async function listedInboxEntries(of: PlainHistoryOf, entries: readonly InboxEntry<StoredPayload>[]): Promise<ListedInboxEntry[]> {
  const held = await heldForList(of, entries.flatMap(({ message, replies }) => [message.payload, ...replies.map(({ payload }) => payload)]));
  const listed = (stored: { id: MessageId; payload: StoredPayload }) => listedOf(held, { fleetId: of.fleetId, stored });
  return entries.map((entry) => ({
    ...entry,
    replies: entry.replies.map((reply) => ({ ...reply, payload: listed(reply) })),
    message: { ...entry.message, payload: listed(entry.message), isPayloadSealed: isSealedPayload(entry.message.payload) },
  }));
}

function listedPayloadOf<T extends { id: MessageId; payload: StoredPayload }>(held: HeldDataKeys, of: { fleetId: FleetId; message: T }): WithListedPayload<T> {
  return { ...of.message, payload: listedOf(held, { fleetId: of.fleetId, stored: of.message }), isPayloadSealed: isSealedPayload(of.message.payload) };
}

function listedOf(held: HeldDataKeys, of: { fleetId: FleetId; stored: { id: MessageId; payload: StoredPayload } }): ListedPayload {
  const listed = listedUnsealed(held, { row: { fleetId: of.fleetId, rowId: of.stored.id }, payload: of.stored.payload });
  // heldForList unwrapped every key these payloads name, or holds it unreachable: one still needed is never met.
  return listed.isOk ? listed.value : UNREADABLE_PAYLOAD;
}
