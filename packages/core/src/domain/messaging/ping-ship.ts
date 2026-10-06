import { PING_CONTENT_TYPE, type IdGenerator, type MessageId, type ShipId } from '@aeolus-fleet/common';

import { findPingableShip, type PingableShipTx, type UnpingableShip } from '../registry/public.js';
import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { RequestHasher } from './ports.js';
import { checkedSend, sendWithin, type SendMessageRefusal, type SendMessageTx } from './send-message.js';

/** What every ping says: the session answers it with pong, and does nothing else with it. */
export const PING_PAYLOAD = 'Ping from argo: answer with pong(deliveryId).';

export type PingShipTx = SendMessageTx & PingableShipTx;

export interface PingSent {
  /** The ship's open ping: the one this call sent, or the one already waiting. */
  messageId: MessageId;
  sentAt: Date;
  /** Whether this call sent it. */
  isNew: boolean;
}

export type PingShipRefusal = UnpingableShip | SendMessageRefusal;

export type PingShip = (caller: Caller, input: { shipId: ShipId }) => Promise<Result<PingSent, PingShipRefusal>>;

/**
 * Use case: argo pings a crewed ship (`fleet.ping`), asking its session to
 * answer with pong. Its scope (fleet:manage) is checked before this runs. A
 * ping is a message with the reserved content type and a fixed payload, sent
 * and delivered as any message is. At most one is open per ship: while one
 * waits unanswered, pending or in flight, this answers with that one and
 * stores nothing. The ship stays locked meanwhile, so two pings take turns.
 * Each new ping carries a fresh idempotency key: a repeat is answered by the
 * open ping, never by the key.
 */
export function createPingShip(deps: {
  uow: UnitOfWork<PingShipTx>;
  clock: Clock;
  ids: IdGenerator;
  hasher: RequestHasher;
}): PingShip {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<PingSent, PingShipRefusal>> => {
      const { fleetId } = caller;
      const ship = await findPingableShip(tx, { fleetId, shipId: input.shipId });
      if (!ship.isOk) {
        return ship;
      }
      const open = await tx.deliveries.findOpenPing(fleetId, input.shipId);
      if (open) {
        return ok({ messageId: open.id, sentAt: open.createdAt, isNew: false });
      }

      const request = checkedSend(
        {
          selector: { kind: 'ship', shipId: input.shipId },
          payload: PING_PAYLOAD,
          contentType: PING_CONTENT_TYPE,
          idempotencyKey: `ping-${deps.ids('message')}`,
        },
        deps.hasher,
      );
      if (!request.isOk) {
        return request;
      }
      const sentAt = deps.clock.now();
      const sent = await sendWithin({ tx, clock: { now: () => sentAt }, ids: deps.ids }, { caller, request: request.value });
      return sent.isOk ? ok({ messageId: sent.value.messageId, sentAt, isNew: true }) : sent;
    });
}
