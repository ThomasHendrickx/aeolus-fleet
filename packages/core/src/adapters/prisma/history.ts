/**
 * The history reads on Postgres (core/shared/history.ts): a ship's timeline
 * from the event log, its messages and one message's delivery history. Each
 * read takes a few queries and names every party in one more, by the ships'
 * current names, so a renamed ship goes by its new name.
 */
import {
  crewStatusSchema,
  DELIVERY_HISTORY_TYPES,
  DELIVERY_STATES,
  deliveryStateSchema,
  idSchema,
  leaseEndReasonSchema,
  locationKindSchema,
  turnStateSchema,
  type FleetId,
  type LeaseId,
  type ShipId,
} from '@aeolus-fleet/common';
import { z } from 'zod';

import { deliveryStepOf, type StandingOverdue, type WayCrew, type WayLease } from '../../domain/shared/delivery-way.js';
import {
  isKeptBy,
  type HistoryMessage,
  type HistoryParty,
  type HistoryRecipient,
  type ShipHistory,
} from '../../domain/shared/history.js';
import type { Message } from '../../domain/messaging/message.js';
import type { Recipient } from '../../domain/shared/selector.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';
import { toMessage, toSequencedEvent } from './rows.js';

/** A pending delivery no ship can take, as the query finds it. */
const noShipCanTakeRow = z.object({ deliveryId: idSchema('delivery'), type: z.string(), messageId: idSchema('message') });

/** What argo was told is overdue, as the clocks stored it (overdue.ts). */
const overdueRow = z.object({
  deliveryId: idSchema('delivery'),
  shipId: idSchema('ship'),
  state: z.enum(['pending', 'received', 'handed']),
  clock: z.enum(['notConfirmed', 'idle', 'busy']),
  minutes: z.number().int(),
  toldAt: z.date(),
});

const deliveryRow = z.object({
  id: idSchema('delivery'),
  state: deliveryStateSchema,
  attempts: z.number().int(),
  claimedByShipId: idSchema('ship').nullable(),
  handOverNumber: z.number().int().nullable(),
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
    model: message.model,
    payload: message.payload,
    delivery: {
      id: delivery.id,
      state: delivery.state,
      attempts: delivery.attempts,
      claimedBy: delivery.claimedByShipId === null ? null : party(delivery.claimedByShipId),
      handOverNumber: delivery.handOverNumber,
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

const DELIVERY_SELECT = { id: true, state: true, attempts: true, claimedByShipId: true, handOverNumber: true } as const;

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
                model: message.model,
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
            { events: { some: { type: 'DeliveryHanded', shipId } } },
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
        include: { deliveries: { select: { ...DELIVERY_SELECT, claimedByLeaseId: true, recipientShipId: true } } },
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
      const leaseId = await leaseOfDelivery(db, { fleetId, delivery: deliveryLeaseRow.parse(row.deliveries[0]) });
      const leases = await wayLeases(db, {
        fleetId,
        leaseIds: [
          ...events.flatMap((event) => (typeof event.details.leaseId === 'string' ? [event.details.leaseId] : [])),
          ...(leaseId === null ? [] : [leaseId]),
        ],
      });
      const replies = (
        await db.message.findMany({ where: { fleetId, inReplyToMessageId: message.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
      ).map(toMessage);
      const party = await partiesOf(db, {
        fleetId,
        shipIds: [
          ...shipsNamedBy(message),
          ...(delivery.claimedByShipId === null ? [] : [delivery.claimedByShipId]),
          ...events.flatMap((event) => (event.shipId === undefined ? [] : [event.shipId])),
          ...replies.map((reply) => reply.senderShipId),
          ...[...leases.values()].flatMap(({ trierarch }) => (trierarch ? [trierarch.id] : [])),
        ],
      });
      return {
        ...historyMessageOf({ message, delivery }, party),
        history: events.flatMap((event) => deliveryStepOf(event, { party, leases })),
        replies: replies.map((reply) => ({ id: reply.id, sender: party(reply.senderShipId), sentAt: reply.createdAt })),
        lease: (leaseId === null ? undefined : leases.get(leaseId)) ?? null,
        overdue: await standingOverdue(db, { fleetId, deliveryId: delivery.id }),
        crew: leaseId === null ? null : await crewOfLease(db, { fleetId, leaseId }),
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
      // The ship's own replies to its inbox's messages, oldest first.
      const replies = (
        await db.message.findMany({
          where: { fleetId, senderShipId: shipId, inReplyToMessageId: { in: found.map(({ message }) => message.id) } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      ).map(toMessage);
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
          replies: replies
            .filter((held) => held.inReplyToMessageId === message.id)
            .map((held) => ({ id: held.id, contentType: held.contentType, payload: held.payload, sentAt: held.createdAt })),
          message: {
            id: message.id,
            sender: party(message.senderShipId),
            inReplyTo: message.inReplyToMessageId,
            sentAt: message.createdAt,
            contentType: message.contentType,
            model: message.model,
            payload: message.payload,
          },
        };
      });
    },

    needsAttention: async (fleetId) => {
      const rows = await db.delivery.findMany({
        where: { fleetId, state: { in: ['undeliverable', 'notHandled'] } },
        select: { id: true, state: true, attempts: true, handOverNumber: true, message: true },
      });
      // Since when each needs attention: its last DeliveryUndeliverable or
      // DeliveryNotHandled, whose place in the stream also orders the list,
      // oldest first.
      const events = (
        await db.event.findMany({
          where: { fleetId, type: { in: ['DeliveryUndeliverable', 'DeliveryNotHandled'] }, deliveryId: { in: rows.map((row) => row.id) } },
          orderBy: { seq: 'asc' },
        })
      ).map(toSequencedEvent);
      const since = new Map(events.map((event) => [event.deliveryId, event]));
      const found = rows.map((row) => {
        const deliveryId = idSchema('delivery').parse(row.id);
        const event = since.get(deliveryId);
        if (!event?.shipId || (row.state !== 'undeliverable' && row.state !== 'notHandled')) {
          throw new Error(`Delivery ${deliveryId} in Needs attention has no DeliveryUndeliverable or DeliveryNotHandled by a ship`);
        }
        return { deliveryId, state: row.state, attempts: row.attempts, isPushed: row.handOverNumber !== null, message: toMessage(row.message), event, shipId: event.shipId };
      });
      const party = await partiesOf(db, { fleetId, shipIds: found.flatMap(({ message, shipId }) => [...shipsNamedBy(message), shipId]) });
      return found
        .sort((first, second) => first.event.seq - second.event.seq)
        .map(({ deliveryId, state, attempts, isPushed, message, event, shipId }) => ({
          deliveryId,
          state,
          attempts,
          isPushed,
          since: event.occurredAt,
          reason: typeof event.details.reason === 'string' ? event.details.reason : null,
          ship: party(shipId),
          message: {
            id: message.id,
            sender: party(message.senderShipId),
            recipient: recipientOf(message.selector, party),
            inReplyTo: message.inReplyToMessageId,
            sentAt: message.createdAt,
            contentType: message.contentType,
            model: message.model,
            payload: message.payload,
          },
        }));
    },

    overdue: async (fleetId) => {
      // Told on a lease that has not ended; it still stands while the delivery
      // is in the state it was told in, held by that lease when in flight.
      const rows = await db.overdueDelivery.findMany({
        where: { fleetId, lease: { endedAt: null } },
        include: { delivery: { select: { state: true, claimedByLeaseId: true, message: true } } },
        orderBy: [{ toldAt: 'asc' }, { deliveryId: 'asc' }],
      });
      const standing = rows
        .filter((row) => row.delivery.state === row.state && (row.state === 'pending' || row.delivery.claimedByLeaseId === row.leaseId))
        .map((row) => ({ told: overdueRow.parse(row), message: toMessage(row.delivery.message) }));
      const party = await partiesOf(db, { fleetId, shipIds: standing.flatMap(({ told, message }) => [told.shipId, ...shipsNamedBy(message)]) });
      return standing.map(({ told, message }) => ({
        deliveryId: told.deliveryId,
        ship: party(told.shipId),
        state: told.state,
        clock: told.clock,
        minutes: told.minutes,
        toldAt: told.toldAt,
        message: {
          id: message.id,
          sender: party(message.senderShipId),
          recipient: recipientOf(message.selector, party),
          inReplyTo: message.inReplyToMessageId,
          sentAt: message.createdAt,
          contentType: message.contentType,
          model: message.model,
          payload: message.payload,
        },
      }));
    },

    noShipCanTake: async (fleetId) => {
      // Pending to a type with no active ship that may claim it: any of the
      // type, or one of the reachable ones under network rules (decision 0034).
      const found = z.array(noShipCanTakeRow).parse(
        await db.$queryRaw`
          SELECT d.id AS "deliveryId", d.recipient_type AS "type", d.message_id AS "messageId"
          FROM deliveries d
          WHERE d.fleet_id = ${fleetId} AND d.state = 'pending' AND d.recipient_type IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM ships s
                            WHERE s.fleet_id = d.fleet_id AND s.type = d.recipient_type AND s.retired_at IS NULL
                              AND (cardinality(d.reachable_ship_ids) = 0 OR s.id = ANY(d.reachable_ship_ids)))
          ORDER BY d.created_at, d.id`,
      );
      const messages = new Map(
        (await db.message.findMany({ where: { fleetId, id: { in: found.map((row) => row.messageId) } } })).map((row) => {
          const message = toMessage(row);
          return [message.id, message];
        }),
      );
      const party = await partiesOf(db, { fleetId, shipIds: [...messages.values()].flatMap(shipsNamedBy) });
      return found.map(({ deliveryId, type, messageId }) => {
        const message = messages.get(messageId);
        if (!message) {
          throw new Error(`Delivery ${deliveryId} no ship can take has no message ${messageId}`);
        }
        return {
          deliveryId,
          type,
          message: {
            id: message.id,
            sender: party(message.senderShipId),
            recipient: recipientOf(message.selector, party),
            inReplyTo: message.inReplyToMessageId,
            sentAt: message.createdAt,
            contentType: message.contentType,
            model: message.model,
            payload: message.payload,
          },
        };
      });
    },

    shipWay: async (fleetId, shipId) => {
      const ship = await db.ship.findFirst({ where: { fleetId, id: shipId }, select: { id: true } });
      if (!ship) {
        return undefined;
      }
      const open = await db.lease.findFirst({ where: { fleetId, shipId, endedAt: null }, select: { id: true } });
      if (!open) {
        return { lease: null, waiting: [] };
      }
      const leaseId = idSchema('lease').parse(open.id);
      // What waits for it as the clocks count it (overdue.ts): in flight with
      // its open lease, or pending for it or, reachable, for its type.
      const waiting = z.array(z.object({ messageId: idSchema('message') })).parse(
        await db.$queryRaw`
          SELECT d.message_id AS "messageId"
          FROM deliveries d
          JOIN ships s ON s.fleet_id = d.fleet_id AND s.id = ${shipId}
          WHERE d.fleet_id = ${fleetId} AND (
            (d.state IN ('received', 'handed') AND d.claimed_by_lease_id = ${leaseId})
            OR (d.state = 'pending' AND (
              d.recipient_ship_id = s.id
              OR (d.recipient_type = s.type AND (cardinality(d.reachable_ship_ids) = 0 OR s.id = ANY(d.reachable_ship_ids))))))
          ORDER BY d.created_at, d.message_id`,
      );
      const lease = (await wayLeases(db, { fleetId, leaseIds: [leaseId] })).get(leaseId) ?? null;
      return { lease, waiting: waiting.map((row) => row.messageId) };
    },
  };
}

/** What a message read takes of its delivery to find its lease. */
const deliveryLeaseRow = z.object({
  id: idSchema('delivery'),
  state: deliveryStateSchema,
  claimedByLeaseId: idSchema('lease').nullable(),
  recipientShipId: idSchema('ship').nullable(),
});

/** The lease that holds the delivery, or the open lease of the one ship a pending delivery waits for. */
async function leaseOfDelivery(db: Db, of: { fleetId: FleetId; delivery: z.infer<typeof deliveryLeaseRow> }): Promise<LeaseId | null> {
  const { fleetId, delivery } = of;
  if (delivery.claimedByLeaseId !== null) {
    return delivery.claimedByLeaseId;
  }
  if (delivery.state !== 'pending' || delivery.recipientShipId === null) {
    return null;
  }
  const open = await db.lease.findFirst({ where: { fleetId, shipId: delivery.recipientShipId, endedAt: null }, select: { id: true } });
  return open ? idSchema('lease').parse(open.id) : null;
}

const wayLeaseRow = z.object({
  id: idSchema('lease'),
  location: locationKindSchema,
  locationDescription: z.string().nullable(),
  harness: z.string().nullable(),
  isPushed: z.boolean(),
  isEnded: z.boolean(),
  turn: turnStateSchema.nullable(),
  turnAt: z.date().nullable(),
  crewedById: idSchema('ship').nullable(),
  crewedByName: z.string().nullable(),
  crewedByKind: z.string().nullable(),
  endReason: z.string().nullable(),
});

/**
 * The leases a delivery's way names: where each session ran, its trierarch
 * (the ship other than argo whose starting prompt its crew claimed with),
 * whether it was pushed, its turn, and why it ended.
 */
async function wayLeases(db: Db, of: { fleetId: FleetId; leaseIds: string[] }): Promise<Map<string, WayLease>> {
  const leaseIds = [...new Set(of.leaseIds)];
  if (leaseIds.length === 0) {
    return new Map();
  }
  const rows = z.array(wayLeaseRow).parse(
    await db.$queryRaw`
      SELECT l.id, l.location::text AS location, l.location_description AS "locationDescription", l.harness,
             l.pushed_at IS NOT NULL AS "isPushed", l.ended_at IS NOT NULL AS "isEnded",
             l.turn::text AS turn, l.turn_at AS "turnAt",
             cb.id AS "crewedById", cb.name AS "crewedByName", cb.kind AS "crewedByKind",
             (SELECT r.details->>'reason' FROM events r
              WHERE r.fleet_id = l.fleet_id AND r.ship_id = l.ship_id AND r.type = 'LeaseRevoked' AND r.details->>'leaseId' = l.id
              ORDER BY r.seq DESC LIMIT 1) AS "endReason"
      FROM leases l
      LEFT JOIN LATERAL (
        SELECT a.id, a.name, a.kind::text AS kind
        FROM events e
        JOIN ships a ON a.fleet_id = e.fleet_id AND a.id = e.actor_ship_id
        WHERE e.fleet_id = l.fleet_id AND e.ship_id = l.ship_id
          AND e.type = 'StartingPromptIssued' AND e.occurred_at <= l.started_at
        ORDER BY e.seq DESC
        LIMIT 1) cb ON true
      WHERE l.fleet_id = ${of.fleetId} AND l.id IN (${Prisma.join(leaseIds)})`,
  );
  return new Map(
    rows.map((row): [string, WayLease] => [
      row.id,
      {
        location: { kind: row.location, description: row.locationDescription },
        harness: row.harness,
        trierarch:
          row.crewedById !== null && row.crewedByName !== null && row.crewedByKind !== 'operator' ? { id: row.crewedById, name: row.crewedByName } : null,
        isPushed: row.isPushed,
        isEnded: row.isEnded,
        endReason: leaseEndReasonSchema.nullable().catch(null).parse(row.endReason),
        turn: row.turn !== null && row.turnAt !== null ? { state: row.turn, at: row.turnAt } : null,
      },
    ]),
  );
}

/** The newest overdue clock argo was told of that still stands for the delivery: still in that state, on that open lease. */
async function standingOverdue(db: Db, of: { fleetId: FleetId; deliveryId: string }): Promise<StandingOverdue | null> {
  const told = await db.overdueDelivery.findMany({
    where: { fleetId: of.fleetId, deliveryId: of.deliveryId, lease: { endedAt: null } },
    include: { delivery: { select: { state: true, claimedByLeaseId: true } } },
    orderBy: { toldAt: 'desc' },
  });
  const standing = told.find((row) => row.delivery.state === row.state && (row.state === 'pending' || row.delivery.claimedByLeaseId === row.leaseId));
  if (!standing) {
    return null;
  }
  const { clock, minutes, toldAt } = overdueRow.parse(standing);
  return { clock, minutes, toldAt };
}

/** How the trierarch says the crew of the lease's ship stands, once it says. */
async function crewOfLease(db: Db, of: { fleetId: FleetId; leaseId: LeaseId }): Promise<WayCrew | null> {
  const lease = await db.lease.findFirst({ where: { fleetId: of.fleetId, id: of.leaseId }, select: { shipId: true } });
  const request = lease && (await db.crewRequest.findFirst({ where: { fleetId: of.fleetId, shipId: lease.shipId } }));
  return request?.status ? { status: crewStatusSchema.parse(request.status), attempt: request.attempt, startedAt: request.sessionStartedAt } : null;
}
