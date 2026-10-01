import type { ShipId } from '@aeolus-fleet/common';

import type { Caller } from './caller.js';
import { refuse, type DomainError } from './errors.js';
import type { HistoryMessage, ShipHistory } from './history.js';
import { ok, type Result } from './result.js';

/** The most messages the ship page lists: the newest ones. */
export const MESSAGES_LIMIT = 200;

/** How much of a payload the list shows. */
export const PREVIEW_LENGTH = 120;

/** A message as the ship page lists it: its payload cut to a preview. */
export type ListedMessage = Omit<HistoryMessage, 'payload' | 'delivery'> & {
  preview: string;
  delivery: Omit<HistoryMessage['delivery'], 'attempts'>;
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
 * type. The caller's scope (fleet:read) is checked before this runs.
 */
export function createReadShipMessages(deps: { history: ShipHistory }): ReadShipMessages {
  return async (caller, { shipId }) => {
    const messages = await deps.history.messages(caller.fleetId, { shipId, limit: MESSAGES_LIMIT });
    if (!messages) {
      return refuse('SHIP_NOT_FOUND', `No ship ${shipId} in this fleet`);
    }
    return ok(
      messages.map(({ payload, delivery, ...message }) => ({
        ...message,
        preview: previewOf(payload),
        delivery: { id: delivery.id, state: delivery.state, claimedBy: delivery.claimedBy },
      })),
    );
  };
}
