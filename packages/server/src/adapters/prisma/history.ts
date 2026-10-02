/**
 * The history reads on Postgres (core/shared/history.ts): a ship's timeline
 * from the event log, its messages and one message's delivery history. Each
 * read takes a few queries and names every party in one more, by the ships'
 * current names, so a renamed ship goes by its new name.
 */
import {
  DELIVERY_HISTORY_TYPES,
  DELIVERY_STATES,
  deliveryStateSchema,
  idSchema,
  locationKindSchema,
  type FleetId,
  type ShipId,
} from '@aeolus-fleet/common';
import { z } from 'zod';

import type { SequencedEvent } from '../../core/shared/events.js';
import {
  isDeliveryChangeType,
  isKeptBy,
  type DeliveryChange,
  type HistoryMessage,
  type HistoryParty,
  type HistoryRecipient,
  type ShipHistory,
} from '../../core/shared/history.js';
import type { Message } from '../../core/messaging/message.js';
import type { Recipient } from '../../core/shared/selector.js';
import type { Db } from './client.js';
import type { Location } from '../../core/registry/public.js';
import { toMessage, toSequencedEvent } from './rows.js';

const deliveryRow = z.object({
  id: idSchema('delivery'),
  state: deliveryStateSchema,
  attempts: z.number().int(),
  claimedByShipId: idSchema('ship').nullable(),
});

type DeliveryNow = z.infer<typeof deliveryRow>;

/** Every ship the reads name, by id, read in one query. */
async function partiesOf(db: Db, of: { fleetId: FleetId; shipIds: Iterable<ShipId> }): Promise<(id: ShipId) => HistoryParty> {
  const ships = await db.ship.findMany({
    where: { fleetId: of.fleetId, id: { in: [...new Set(of.shipIds)] } },
    select: { id: true, name: true },
  });
  const names = new Map(ships.map((ship) => [ship.id, ship.name]));
  return (id) => {
    const name = names.get(id);
    if (name === undefined) {
      throw new Error(`No ship ${id} in fleet ${of.fleetId}`);
    }
    return { id, name };
  };
}

function shipsNamedBy(message: Message): ShipId[] {
  return message.selector.kind === 'ship' ? [message.senderShipId, message.selector.shipId] : [message.senderShipId];
}

function recipientOf(selector: Recipient, party: (id: ShipId) => HistoryParty): HistoryRecipient {
  return selector.kind === 'ship' ? { kind: 'ship', ship: party(selector.shipId) } : selector;
}

function historyMessageOf(
  found: { message: Message; delivery: DeliveryNow },
  party: (id: ShipId) => HistoryParty,
): HistoryMessage {
  const { message, delivery } = found;
  return {
    id: message.id,
    sender: party(message.senderShipId),
    recipient: recipientOf(message.selector, party),
    inReplyTo: message.inReplyToMessageId,
    sentAt: message.createdAt,
    contentType: message.contentType,
    payload: message.payload,
    delivery: {
      id: delivery.id,
      state: delivery.state,
      attempts: delivery.attempts,
      claimedBy: delivery.claimedByShipId === null ? null : party(delivery.claimedByShipId),
    },
  };
}

/** A message's one delivery: v1 sends every message to one recipient. */
function onlyDelivery(row: { id: string; deliveries: unknown[] }): DeliveryNow {
  const [delivery] = row.deliveries;
  if (delivery === undefined) {
    throw new Error(`Message ${row.id} has no delivery`);
  }
  return deliveryRow.parse(delivery);
}

const DELIVERY_SELECT = { id: true, state: true, attempts: true, claimedByShipId: true } as const;

async function shipExists(db: Db, at: { fleetId: FleetId; shipId: ShipId }): Promise<boolean> {
  return (await db.ship.count({ where: { fleetId: at.fleetId, id: at.shipId } })) === 1;
}

export function createPrismaShipHistory(db: Db): ShipHistory {
  return {
    timeline: async (fleetId, { shipId, limit }) => {
      if (!(await shipExists(db, { fleetId, shipId }))) {
        return undefined;
      }
      const events = (
        await db.event.findMany({
          where: { fleetId, OR: [{ shipId }, { actorShipId: shipId }] },
          orderBy: { seq: 'desc' },
          take: limit,
        })
      ).map(toSequencedEvent);
      const messageIds = [...new Set(events.flatMap((event) => (event.messageId === undefined ? [] : [event.messageId])))];
      const messages = new Map(
        (await db.message.findMany({ where: { fleetId, id: { in: messageIds } } }))
          .map(toMessage)
          .map((message) => [message.id, message]),
      );
      const party = await partiesOf(db, {
        fleetId,
        shipIds: [
          ...events.flatMap((event) => [
            ...(event.actor.kind === 'ship' ? [event.actor.shipId] : []),
            ...(event.shipId === undefined ? [] : [event.shipId]),
          ]),
          ...[...messages.values()].flatMap(shipsNamedBy),
        ],
      });
      return events.map((event) => {
        const message = event.messageId === undefined ? undefined : messages.get(event.messageId);
        return {
          seq: event.seq,
          id: event.id,
          type: event.type,
          occurredAt: event.occurredAt,
          actor: event.actor.kind === 'ship' ? party(event.actor.shipId) : null,
          ship: event.shipId === undefined ? null : party(event.shipId),
          message: message
            ? {
                id: message.id,
                sender: party(message.senderShipId),
                recipient: recipientOf(message.selector, party),
                contentType: message.contentType,
              }
            : null,
          details: event.details,
        };
      });
    },

    messages: async (fleetId, { shipId, limit }) => {
      if (!(await shipExists(db, { fleetId, shipId }))) {
        return undefined;
      }
      // A message to a type shows on the page of each ship that claimed it,
      // which only the event log remembers once another ship holds it.
      const rows = await db.message.findMany({
        where: {
          fleetId,
          OR: [
            { senderShipId: shipId },
            { selectorShipId: shipId },
            { events: { some: { type: 'DeliveryClaimed', shipId } } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        include: { deliveries: { select: DELIVERY_SELECT } },
      });
      const found = rows.map((row) => ({ message: toMessage(row), delivery: onlyDelivery(row) }));
      const party = await partiesOf(db, {
        fleetId,
        shipIds: found.flatMap(({ message, delivery }) => [
          ...shipsNamedBy(message),
          ...(delivery.claimedByShipId === null ? [] : [delivery.claimedByShipId]),
        ]),
      });
      return found.map((each) => historyMessageOf(each, party));
    },

    message: async (fleetId, messageId) => {
      const row = await db.message.findFirst({
        where: { fleetId, id: messageId },
        include: { deliveries: { select: DELIVERY_SELECT } },
      });
      if (!row) {
        return undefined;
      }
      const message = toMessage(row);
      const delivery = onlyDelivery(row);
      const events = (
        await db.event.findMany({
          where: { fleetId, deliveryId: delivery.id, type: { in: [...DELIVERY_HISTORY_TYPES] } },
          orderBy: { seq: 'desc' },
        })
      ).map(toSequencedEvent);
      const leases = await claimingLeases(db, { fleetId, events });
      const party = await partiesOf(db, {
        fleetId,
        shipIds: [
          ...shipsNamedBy(message),
          ...(delivery.claimedByShipId === null ? [] : [delivery.claimedByShipId]),
          ...events.flatMap((event) => (event.shipId === undefined ? [] : [event.shipId])),
        ],
      });
      return {
        ...historyMessageOf({ message, delivery }, party),
        history: events.flatMap((event) => changeOf(event, { party, leases })),
      };
    },

    inbox: async (fleetId, { shipId, filter }) => {
      const rows = await db.delivery.findMany({
        where: {
          fleetId,
          recipientShipId: shipId,
          state: { in: DELIVERY_STATES.filter((state) => isKeptBy(filter, state)) },
        },
        select: { id: true, state: true, readAt: true, message: true },
        orderBy: [{ message: { createdAt: 'desc' } }, { messageId: 'desc' }],
      });
      // When each was done, and by which reply: its last DeliveryAcknowledged.
      const acknowledged = new Map(
        (
          await db.event.findMany({
            where: { fleetId, type: 'DeliveryAcknowledged', deliveryId: { in: rows.map((row) => row.id) } },
            orderBy: { seq: 'asc' },
          })
        )
          .map(toSequencedEvent)
          .map((event) => [event.deliveryId, event]),
      );
      const found = rows.map((row) => ({ row, message: toMessage(row.message) }));
      const party = await partiesOf(db, { fleetId, shipIds: found.map(({ message }) => message.senderShipId) });
      return found.map(({ row, message }) => {
        const deliveryId = idSchema('delivery').parse(row.id);
        const done = acknowledged.get(deliveryId);
        const reply = done?.details.reply;
        return {
          deliveryId,
          state: deliveryStateSchema.parse(row.state),
          readAt: row.readAt,
          doneAt: done?.occurredAt ?? null,
          repliedWith: typeof reply === 'string' ? idSchema('message').parse(reply) : null,
          message: {
            id: message.id,
            sender: party(message.senderShipId),
            inReplyTo: message.inReplyToMessageId,
            sentAt: message.createdAt,
            contentType: message.contentType,
            payload: message.payload,
          },
        };
      });
    },

    undeliverable: async (fleetId) => {
      const rows = await db.delivery.findMany({
        where: { fleetId, state: 'undeliverable' },
        select: { id: true, attempts: true, message: true },
      });
      // When each became undeliverable: its last DeliveryUndeliverable, whose
      // place in the stream also orders the list, oldest first.
      const events = (
        await db.event.findMany({
          where: { fleetId, type: 'DeliveryUndeliverable', deliveryId: { in: rows.map((row) => row.id) } },
          orderBy: { seq: 'asc' },
        })
      ).map(toSequencedEvent);
      const since = new Map(events.map((event) => [event.deliveryId, event]));
      const found = rows.map((row) => {
        const deliveryId = idSchema('delivery').parse(row.id);
        const event = since.get(deliveryId);
        if (!event) {
          throw new Error(`Undeliverable delivery ${deliveryId} has no DeliveryUndeliverable`);
        }
        return { deliveryId, attempts: row.attempts, message: toMessage(row.message), event };
      });
      const party = await partiesOf(db, { fleetId, shipIds: found.flatMap(({ message }) => shipsNamedBy(message)) });
      return found
        .sort((first, second) => first.event.seq - second.event.seq)
        .map(({ deliveryId, attempts, message, event }) => ({
          deliveryId,
          attempts,
          since: event.occurredAt,
          message: {
            id: message.id,
            sender: party(message.senderShipId),
            recipient: recipientOf(message.selector, party),
            inReplyTo: message.inReplyToMessageId,
            sentAt: message.createdAt,
            contentType: message.contentType,
            payload: message.payload,
          },
        }));
    },
  };
}

/** The leases of the claims among the events, for where each claiming session ran. */
async function claimingLeases(db: Db, of: { fleetId: FleetId; events: SequencedEvent[] }) {
  const leaseIds = of.events.flatMap((event) => {
    const { leaseId } = event.details;
    return event.type === 'DeliveryClaimed' && typeof leaseId === 'string' ? [leaseId] : [];
  });
  const leases = await db.lease.findMany({
    where: { fleetId: of.fleetId, id: { in: leaseIds } },
    select: { id: true, location: true, locationDescription: true },
  });
  return new Map(
    leases.map((lease): [string, Location] => [
      lease.id,
      { kind: locationKindSchema.parse(lease.location), description: lease.locationDescription },
    ]),
  );
}

function changeOf(
  event: SequencedEvent,
  read: { party: (id: ShipId) => HistoryParty; leases: Map<string, Location> },
): DeliveryChange[] {
  const { type } = event;
  if (!isDeliveryChangeType(type)) {
    return [];
  }
  const { leaseId, attempts } = event.details;
  const location = event.type === 'DeliveryClaimed' && typeof leaseId === 'string' ? read.leases.get(leaseId) : undefined;
  return [
    {
      seq: event.seq,
      type,
      occurredAt: event.occurredAt,
      ship: type === 'MessageAccepted' || event.shipId === undefined ? null : read.party(event.shipId),
      location: location ?? null,
      attempts: typeof attempts === 'number' ? attempts : null,
    },
  ];
}

