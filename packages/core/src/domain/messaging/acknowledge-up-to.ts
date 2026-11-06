import { isConventionContentType, type IdGenerator, type MessageId, type ShipId } from '@aeolus-fleet/common';

import { holdLease, type HoldLeaseTx, type LeaseEnded } from '../registry/public.js';
import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { acknowledgeSeen } from './delivery.js';
import { isInExchange } from './exchange.js';
import type { DeliveryRepository, MessageRepository } from './ports.js';

export interface AcknowledgeUpToTx extends HoldLeaseTx {
  messages: Pick<MessageRepository, 'find'>;
  deliveries: Pick<DeliveryRepository, 'findOfMessageReaching' | 'findUnacknowledgedUpToForUpdate' | 'update'>;
  events: EventLog;
}

export type AcknowledgeUpToRefusal = DomainError<'NOT_A_PERSON_SHIP' | 'MESSAGE_NOT_FOUND'> | LeaseEnded;

export type AcknowledgeUpTo = (
  crew: Crew,
  input: { otherShipId: ShipId; messageId: MessageId },
) => Promise<Result<{ acknowledged: number }, AcknowledgeUpToRefusal>>;

/**
 * Use case: seen up to here (`ackUpTo`, docs/design/exchange-read, E6, E7).
 * A person ship's crew acknowledges the other ship's deliveries to its ship
 * up to and including the named message, pending, received or handed, of
 * every content type but the conventions, which each have their own way to
 * be done. One unit of work: each delivery locked in id order, acknowledged
 * with its DeliveryAcknowledged, the exchanges rollup in step; one another
 * unit of work holds is waited for, so none is skipped. Again changes
 * nothing. A message that is not the other ship's to the crew's ship is
 * refused as not found. Its scope (messages:receive) is checked before this
 * runs.
 */
export function createAcknowledgeUpTo(deps: { uow: UnitOfWork<AcknowledgeUpToTx>; clock: Clock; ids: IdGenerator }): AcknowledgeUpTo {
  return (crew, input) =>
    deps.uow.run(async (tx): Promise<Result<{ acknowledged: number }, AcknowledgeUpToRefusal>> => {
      if (crew.kind !== 'person') {
        return refuse('NOT_A_PERSON_SHIP', "Only a person ship's crew marks an exchange seen: acknowledge each delivery once it is handed over");
      }
      const held = await holdLease(tx, crew);
      if (!held.isOk) {
        return held;
      }
      const message = await tx.messages.find(crew.fleetId, input.messageId);
      const upTo =
        message?.senderShipId === input.otherShipId && isInExchange(message)
          ? await tx.deliveries.findOfMessageReaching(crew.fleetId, { messageId: message.id, shipId: crew.shipId })
          : undefined;
      if (!upTo) {
        return refuse('MESSAGE_NOT_FOUND', `Message ${input.messageId} is not one ship ${input.otherShipId} sent to your ship`);
      }
      const open = await tx.deliveries.findUnacknowledgedUpToForUpdate({ fleetId: crew.fleetId, shipId: crew.shipId, otherShipId: input.otherShipId, upTo: upTo.id });
      const at = deps.clock.now();
      let acknowledged = 0;
      for (const { delivery, message: carried } of open) {
        if (isConventionContentType(carried.contentType)) {
          continue;
        }
        const seen = acknowledgeSeen(delivery, { crew, at });
        if (seen.events.length === 0) {
          continue;
        }
        await tx.deliveries.update(seen.delivery);
        for (const event of seen.events) {
          await recordEvent({ events: tx.events, ids: deps.ids }, event);
        }
        acknowledged += 1;
      }
      return ok({ acknowledged });
    });
}
