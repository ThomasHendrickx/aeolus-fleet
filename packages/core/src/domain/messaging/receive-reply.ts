import type { IdGenerator, MessageId } from '@aeolus-fleet/common';

import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { withDataKeys, type PayloadSealing } from './data-keys.js';
import { claimForCrew, type DeliveriesReceived, type ReceiveDeliveriesTx, type ReceiveRefusal } from './receive-deliveries.js';

export type ReceiveReply = (crew: Crew, input: { messageId: MessageId }) => Promise<Result<DeliveriesReceived, ReceiveRefusal>>;

/** A reply is one delivery: the oldest that completes the call the crew waits on. */
const REPLY_MAX = 1;

/**
 * Use case: a crew receives the reply to one message (`receiveReply`), so a
 * crew with many open requests, such as the gateway's proxy ship, takes the
 * reply that completes the one it waits on rather than the oldest delivery.
 * Its scope (messages:receive) is checked before this runs.
 *
 * It hands at most one delivery whose message names `messageId` as the
 * message it replies to, as `receive` hands one: first such a delivery in
 * flight with the crew's lease, again as another attempt, then the oldest
 * pending one for its ship or its type. Its states, attempts, undeliverable
 * and ack are `receive`'s, as is its pushed lease, which hands nothing, and
 * its answer at once when no reply is there (decision 0072). It only ever
 * hands the crew's own deliveries, so the message it names needs no check of
 * its own.
 */
export function createReceiveReply(deps: {
  uow: UnitOfWork<ReceiveDeliveriesTx>;
  clock: Clock;
  ids: IdGenerator;
  sealing: PayloadSealing;
}): ReceiveReply {
  return async (crew, input) => {
    const claimed = await withDataKeys({ sealing: deps.sealing, fleetId: crew.fleetId }, (keys) =>
      deps.uow.run((tx) => claimForCrew({ tx, ids: deps.ids, at: deps.clock.now(), keys }, { crew, max: REPLY_MAX, inReplyTo: input.messageId })),
    );
    return claimed.isOk ? ok({ deliveries: claimed.value.deliveries }) : claimed;
  };
}
