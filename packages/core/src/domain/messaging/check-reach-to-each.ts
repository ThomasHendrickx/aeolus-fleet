import type { FleetId, IdGenerator, ShipId } from '@aeolus-fleet/common';

import { checkReach, type CheckReachTx, type NotReachable } from '../registry/public.js';
import { ok, type Result } from '../shared/result.js';
import type { Recipient } from '../shared/selector.js';
import { isAnswerToSender } from './answer.js';
import type { Delivery, Message } from './message.js';

/**
 * Whether the sender reaches each recipient by send, each checked as a send
 * to it alone: a label selection reaches every ship of its list or none
 * (decision 0065, D4). The first refused stops the check, its refusal
 * recorded as any. `asked` is the message the send answers and the
 * sender's delivery of it, when it answers one.
 */
export async function checkReachToEach(
  deps: { tx: CheckReachTx; ids: IdGenerator },
  send: { fleetId: FleetId; senderShipId: ShipId; recipients: readonly Recipient[]; asked: { message: Message; delivery: Delivery } | undefined; at: Date },
): Promise<Result<undefined, NotReachable>> {
  const { fleetId, senderShipId, asked, at } = send;
  for (const recipient of send.recipients) {
    const reach = await checkReach(deps, { fleetId, senderShipId, recipient, isAnswerToSender: isAnswerToSender({ senderShipId, recipient }, asked), at });
    if (!reach.isOk) {
      return reach;
    }
  }
  return ok(undefined);
}
