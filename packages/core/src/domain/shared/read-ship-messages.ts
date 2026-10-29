import { PAGE_SIZE_DEFAULT, type MessageId, type ShipId } from '@aeolus-fleet/common';

import type { Caller } from './caller.js';
import { refuse, type DomainError } from './errors.js';
import { readsMessage, type ReadReachOf } from '../registry/public.js';
import { partiesOf, type HistoryMessage, type ShipHistory } from './history.js';
import type { Page } from './page.js';
import { listedMessages, type PlainHistoryOf } from './plain-history.js';
import { ok, type Result } from './result.js';
import type { PayloadSealing } from '../messaging/public.js';

/** How much of a payload the list shows. */
export const PREVIEW_LENGTH = 120;

/** A message as the ship page lists it: its payload cut to a preview. */
export type ListedMessage = Omit<HistoryMessage, 'payload' | 'delivery'> & {
  /** Empty when its payload is unreadable. */
  preview: string;
  /** Its payload is sealed under a data key that cannot be had, or does not open (decision 0068, B9). */
  isPayloadUnreadable: boolean;
  delivery: Omit<HistoryMessage['delivery'], 'attempts' | 'handOverNumber'> & {
    /** Handed by a plain receive, with no hand-over number: it reads handed (pulled). False in every other state. */
    isPulled: boolean;
  };
};

export type ReadShipMessages = (
  caller: Caller,
  input: { shipId: ShipId; cursor?: MessageId; limit?: number },
) => Promise<Result<Page<ListedMessage, MessageId>, DomainError<'SHIP_NOT_FOUND'>>>;

/** The start of a payload on one line: whitespace runs become one space. */
export function previewOf(payload: string): string {
  return payload.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH);
}

/**
 * Use case: a page of the messages a ship sent, was sent, or claimed as a ship
 * of their type, newest first, each with its delivery as it stands. A message to a type
 * shows on the page of each ship that claimed it, never on every ship of the
 * type. Only the messages the caller reads, through their sender or their
 * recipient (decision 0034). The caller's scope (fleet:read) is checked
 * before this runs. In a sealed fleet each preview is cut from its payload
 * unsealed; one whose key cannot be had is marked unreadable, with no
 * preview (decision 0068, B9).
 */
export function createReadShipMessages(deps: { history: ShipHistory; readReach: ReadReachOf; sealing: PayloadSealing }): ReadShipMessages {
  return async (caller, { shipId, cursor, limit = PAGE_SIZE_DEFAULT }) => {
    const messages = await deps.history.messages(caller.fleetId, { shipId, cursor, limit });
    if (!messages) {
      return refuse('SHIP_NOT_FOUND', `No ship ${shipId} in this fleet`);
    }
    const reach = await deps.readReach(caller);
    const of: PlainHistoryOf = { sealing: deps.sealing, fleetId: caller.fleetId };
    const listed = await listedMessages(of, messages.items.filter((message) => readsMessage(reach, partiesOf(message, message.delivery.claimedBy))));
    return ok({
      items: listed.map(({ payload, delivery, ...message }) => ({
        ...message,
        preview: typeof payload === 'string' ? previewOf(payload) : '',
        isPayloadUnreadable: typeof payload !== 'string',
        delivery: {
          id: delivery.id,
          state: delivery.state,
          claimedBy: delivery.claimedBy,
          isPulled: delivery.state === 'handed' && delivery.handOverNumber === null,
        },
      })),
      nextCursor: messages.nextCursor,
    });
  };
}
