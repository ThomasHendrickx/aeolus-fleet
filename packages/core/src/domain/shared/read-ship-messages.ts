import type { ShipId } from '@aeolus-fleet/common';

import type { Caller } from './caller.js';
import { refuse, type DomainError } from './errors.js';
import { readsMessage, type ReadReachOf } from '../registry/public.js';
import { partiesOf, type HistoryMessage, type ShipHistory } from './history.js';
import { ok, type Result } from './result.js';

/** The most messages the ship page lists: the newest ones. */
export const MESSAGES_LIMIT = 200;

/** How much of a payload the list shows. */
export const PREVIEW_LENGTH = 120;

/** A message as the ship page lists it: its payload cut to a preview. */
export type ListedMessage = Omit<HistoryMessage, 'payload' | 'delivery'> & {
  preview: string;
  delivery: Omit<HistoryMessage['delivery'], 'attempts' | 'handOverNumber'> & {
    /** Handed by a plain receive, with no hand-over number: it reads handed (pulled). False in every other state. */
    isPulled: boolean;
  };
};

export type ReadShipMessages = (
  caller: Caller,
  input: { shipId: ShipId },
) => Promise<Result<ListedMessage[], DomainError<'SHIP_NOT_FOUND'>>>;

/** The start of a payload on one line: whitespace runs become one space. */
export function previewOf(payload: string): string {
  return payload.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH);
}

/**
 * Use case: the messages a ship sent, was sent, or claimed as a ship of their
 * type, newest first, each with its delivery as it stands. A message to a type
 * shows on the page of each ship that claimed it, never on every ship of the
 * type. Only the messages the caller reads, through their sender or their
 * recipient (decision 0034). The caller's scope (fleet:read) is checked
 * before this runs.
 */
export function createReadShipMessages(deps: { history: ShipHistory; readReach: ReadReachOf }): ReadShipMessages {
  return async (caller, { shipId }) => {
    const messages = await deps.history.messages(caller.fleetId, { shipId, limit: MESSAGES_LIMIT });
    if (!messages) {
      return refuse('SHIP_NOT_FOUND', `No ship ${shipId} in this fleet`);
    }
    const reach = await deps.readReach(caller);
    return ok(
      messages.filter((message) => readsMessage(reach, partiesOf(message, message.delivery.claimedBy))).map(({ payload, delivery, ...message }) => ({
        ...message,
        preview: previewOf(payload),
        delivery: {
          id: delivery.id,
          state: delivery.state,
          claimedBy: delivery.claimedBy,
          isPulled: delivery.state === 'handed' && delivery.handOverNumber === null,
        },
      })),
    );
  };
}
