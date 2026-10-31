import type { IdGenerator, MessageId } from '@aeolus-fleet/common';

import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { ReceiverWakeups } from './ports.js';
import { withDataKeys, type PayloadSealing } from './data-keys.js';
import { claimForCrew, RECEIVE_WAIT_MS, waitForDeliveries, type DeliveriesReceived, type ReceiveDeliveriesTx, type ReceiveRefusal } from './receive-deliveries.js';

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
 * and ack are `receive`'s, as is its wait of about 25 seconds and its pushed
 * lease, which hands nothing. It only ever hands the crew's own deliveries,
 * so the message it names needs no check of its own.
 */
export function createReceiveReply(deps: {
  uow: UnitOfWork<ReceiveDeliveriesTx>;
  clock: Clock;
  ids: IdGenerator;
  sealing: PayloadSealing;
  wakeups: ReceiverWakeups;
  /** How long it waits for the reply; about 25 seconds unless a test says otherwise. */
  waitMs?: number;
}): ReceiveReply {
  const waitMs = deps.waitMs ?? RECEIVE_WAIT_MS;
  return (crew, input) =>
    waitForDeliveries(
      { clock: deps.clock, wakeups: deps.wakeups, waitMs },
      {
        crew,
        look: () =>
          withDataKeys({ sealing: deps.sealing, fleetId: crew.fleetId }, (keys) =>
            deps.uow.run((tx) => claimForCrew({ tx, ids: deps.ids, at: deps.clock.now(), keys }, { crew, max: REPLY_MAX, inReplyTo: input.messageId })),
          ),
      },
    );
}
