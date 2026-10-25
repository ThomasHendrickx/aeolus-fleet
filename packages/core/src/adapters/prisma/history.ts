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
  leaseWakerSchema,
  withdrawalOf,
  type DeliveryId,
  type FleetId,
  type LabelValueId,
  type LeaseId,
  type ShipId,
} from '@aeolus-fleet/common';
import { z } from 'zod';

import { deliveryStepOf, type StandingOverdue, type WayCrew, type WayLease } from '../../domain/shared/delivery-way.js';
import {
  isDeliveryChangeType,
  isKeptBy,
  type HistoryMessage,
  type HistoryParty,
  type HistoryRecipient,
  type InboxEntry,
  type ShipHistory,
} from '../../domain/shared/history.js';
import type { Message } from '../../domain/messaging/message.js';
import type { Addressee } from '../../domain/shared/selector.js';
import { pageOf, type PageQuery } from '../../domain/shared/page.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';
import { toMessage, toSequencedEvent } from './rows.js';

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

/** The texts of every label value the messages' selections name, read in one query. */
type LabelTexts = ReadonlyMap<LabelValueId, { key: string; value: string }>;

async function labelTextsOf(db: Db, of: { fleetId: FleetId; messages: Iterable<Message> }): Promise<LabelTexts> {
  const valueIds = [...new Set([...of.messages].flatMap((message) => (message.selector.kind === 'label' ? message.selector.valueIds : [])))];
  if (valueIds.length === 0) {
    return new Map();
  }
  const values = await db.labelValue.findMany({ where: { fleetId: of.fleetId, id: { in: valueIds } }, select: { id: true, value: true, label: { select: { key: true } } } });
  return new Map(values.map((row) => [idSchema('labelValue').parse(row.id), { key: row.label.key, value: row.value }]));
}

/** Who a message went to, its ship by name and a label selection by its texts; a value its label no longer has by its id alone. */
function recipientOf(selector: Addressee, names: { party: (id: ShipId) => HistoryParty; labelTexts: LabelTexts }): HistoryRecipient {
  switch (selector.kind) {
    case 'ship':
      return { kind: 'ship', ship: names.party(selector.shipId) };
    case 'label':
      return { kind: 'label', values: selector.valueIds.map((valueId) => ({ valueId, key: null, value: null, ...names.labelTexts.get(valueId) })) };
    case 'type':
    case 'meeting':
      return selector;
  }
}

function historyMessageOf(
  found: { message: Message; delivery: DeliveryNow },
  names: { party: (id: ShipId) => HistoryParty; labelTexts: LabelTexts },
): HistoryMessage {
  const { message, delivery } = found;
  const { party } = names;
  return {
    id: message.id,
    sender: party(message.senderShipId),
    recipient: recipientOf(message.selector, names),
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

/** A message's first delivery by id: its only one, but for a send to a label (decision 0065), whose deliveries the read orders by id. */
function onlyDelivery(row: { id: string; deliveries: unknown[] }): DeliveryNow {
  const [delivery] = row.deliveries;
  if (delivery === undefined) {
    throw new Error(`Message ${row.id} has no delivery`);
  }
  return deliveryRow.parse(delivery);
}

const DELIVERY_SELECT = { id: true, state: true, attempts: true, claimedByShipId: true, handOverNumber: true } as const;

/**
 * The deliveries to the ship of the messages that withdraw or replace the
 * question, oldest first: one more than the page. Read through
 * messages_question_id_idx, whose expression reads the question id from the
 * payload and never fails on one that is not JSON.
 */
export function inboxWithdrawalsStatement(fleetId: FleetId, { shipId, questionId, cursor, limit }: { shipId: ShipId; questionId: string } & PageQuery<DeliveryId>): Prisma.Sql {
  return Prisma.sql`
    SELECT d.id FROM messages m
    JOIN deliveries d ON d.fleet_id = m.fleet_id AND d.message_id = m.id
    WHERE m.fleet_id = ${fleetId}
      AND lower(m.content_type) LIKE 'application/vnd.aeolus.question-%'
      AND substring(m.payload from '"questionId"\\s*:\\s*"([^"]*)"') = ${questionId}
      AND d.recipient_ship_id = ${shipId}
      ${cursor === undefined ? Prisma.empty : Prisma.sql`AND d.id > ${cursor}`}
    ORDER BY d.id ASC
    LIMIT ${limit + 1}`;
}

/** What the inbox reads of a delivery to list it. */
const INBOX_ROW = { id: true, state: true, readAt: true, message: true } as const;

/**
 * Deliveries to the ship itself as its inbox lists them, in their order:
 * when each was done and by which reply (its last DeliveryAcknowledged), and
 * the ship's own replies to each, oldest first.
 */
async function inboxEntriesOf(
  db: Db,
  { fleetId, shipId, rows }: { fleetId: FleetId; shipId: ShipId; rows: Prisma.DeliveryGetPayload<{ select: typeof INBOX_ROW }>[] },
): Promise<InboxEntry[]> {
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
}

async function shipExists(db: Db, at: { fleetId: FleetId; shipId: ShipId }): Promise<boolean> {
  return (await db.ship.count({ where: { fleetId: at.fleetId, id: at.shipId } })) === 1;
}

export function createPrismaShipHistory(db: Db): ShipHistory {
  return {
    timeline: async (fleetId, { shipId, cursor, limit }) => {
      if (!(await shipExists(db, { fleetId, shipId }))) {
        return undefined;
      }
      const before = cursor === undefined ? undefined : (await db.event.findFirst({ where: { fleetId, id: cursor }, select: { seq: true } }))?.seq;
      if (cursor !== undefined && before === undefined) {
        // An event the fleet does not have starts no page: nothing comes after it.
        return { items: [], nextCursor: null };
      }
      // The events naming the ship and those it caused, each read in stream
      // order through its own index, then merged: an OR would read every
      // event of the ship to sort them.
      const page = { seq: before === undefined ? undefined : { lt: before } };
      const [naming, caused] = await Promise.all([
        db.event.findMany({ where: { fleetId, shipId, ...page }, orderBy: { seq: 'desc' }, take: limit + 1 }),
        db.event.findMany({ where: { fleetId, actorShipId: shipId, ...page }, orderBy: { seq: 'desc' }, take: limit + 1 }),
      ]);
      const merged = new Map([...naming, ...caused].map((row) => [row.id, row]));
      const newestFirst = [...merged.values()].sort((first, second) => (first.seq < second.seq ? 1 : -1));
      const { items: rows, nextCursor } = pageOf(newestFirst, { limit, cursorOf: (row) => idSchema('event').parse(row.id) });
      const events = rows.map(toSequencedEvent);
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
      const labelTexts = await labelTextsOf(db, { fleetId, messages: messages.values() });
      const entries = events.map((event) => {
        const message = event.messageId === undefined ? undefined : messages.get(event.messageId);
        return {
          seq: event.seq,
          id: event.id,
          type: event.type,
          occurredAt: event.occurredAt,
          actor: event.actor.kind === 'ship' ? party(event.actor.shipId) : null,
          signedInAccountId: event.actor.kind === 'ship' ? (event.actor.signedInAccountId ?? null) : null,
          ship: event.shipId === undefined ? null : party(event.shipId),
          message: message
            ? {
                id: message.id,
                sender: party(message.senderShipId),
                recipient: recipientOf(message.selector, { party, labelTexts }),
                contentType: message.contentType,
                model: message.model,
              }
            : null,
          details: event.details,
        };
      });
      return { items: entries, nextCursor };
    },

    messages: async (fleetId, { shipId, cursor, limit }) => {
      if (!(await shipExists(db, { fleetId, shipId }))) {
        return undefined;
      }
      // The messages it sent, those sent to it and those it claimed as a ship
      // of their type, each read newest first through its own index, then
      // merged: an OR would read every message of the ship to sort them. A
      // message to a type shows on the page of each ship that claimed it,
      // which only the event log remembers once another ship holds it. A
      // contribution to a meeting is left out: the meeting's read shows it,
      // with a delivery for each participant (decision 0061).
      const before = cursor === undefined ? {} : { lt: cursor };
      const [sent, sentTo, claimed] = await Promise.all([
        db.message.findMany({ where: { fleetId, senderShipId: shipId, selectorKind: { not: 'meeting' }, id: before }, select: { id: true }, orderBy: { id: 'desc' }, take: limit + 1 }),
        db.message.findMany({ where: { fleetId, selectorShipId: shipId, id: before }, select: { id: true }, orderBy: { id: 'desc' }, take: limit + 1 }),
        db.$queryRaw`
          SELECT DISTINCT message_id AS id FROM events
          WHERE fleet_id = ${fleetId} AND type = 'DeliveryHanded' AND ship_id = ${shipId}
            AND (${cursor ?? null}::text IS NULL OR message_id < ${cursor ?? null})
          ORDER BY message_id DESC
          LIMIT ${limit + 1}`.then((claimedRows) => z.array(z.object({ id: idSchema('message') })).parse(claimedRows)),
      ]);
      const newestFirst = [...new Set([...sent, ...sentTo, ...claimed].map((row) => idSchema('message').parse(row.id)))].sort().reverse();
      const page = pageOf(newestFirst, { limit, cursorOf: (id) => id });
      const rows = await db.message.findMany({
        where: { fleetId, id: { in: page.items }, selectorKind: { not: 'meeting' } },
        orderBy: { id: 'desc' },
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
      const labelTexts = await labelTextsOf(db, { fleetId, messages: found.map(({ message }) => message) });
      return { items: found.map((each) => historyMessageOf(each, { party, labelTexts })), nextCursor: page.nextCursor };
    },

    message: async (fleetId, messageId) => {
      const [row, deliveryCount] = await Promise.all([
        db.message.findFirst({
          where: { fleetId, id: messageId },
          include: { deliveries: { select: { ...DELIVERY_SELECT, claimedByLeaseId: true, recipientShipId: true }, orderBy: { id: 'asc' }, take: 1 } },
        }),
        db.delivery.count({ where: { fleetId, messageId } }),
      ]);
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
      const labelTexts = await labelTextsOf(db, { fleetId, messages: [message] });
      return {
        ...historyMessageOf({ message, delivery }, { party, labelTexts }),
        history: events.flatMap((event) => deliveryStepOf(event, { party, leases })),
        deliveryCount,
        replies: replies.map((reply) => ({ id: reply.id, sender: party(reply.senderShipId), sentAt: reply.createdAt })),
        lease: (leaseId === null ? undefined : leases.get(leaseId)) ?? null,
        overdue: await standingOverdue(db, { fleetId, deliveryId: delivery.id }),
        crew: leaseId === null ? null : await crewOfLease(db, { fleetId, leaseId }),
      };
    },

    messageDeliveries: async (fleetId, { messageId, cursor, limit }) => {
      // Through deliveries_fleet_id_message_id_id_idx: a page costs the same however many ships a label reached.
      const page = pageOf(
        await db.delivery.findMany({
          where: { fleetId, messageId, ...(cursor === undefined ? {} : { id: { gt: cursor } }) },
          select: { id: true, state: true, recipientShipId: true, claimedByShipId: true },
          orderBy: { id: 'asc' },
          take: limit + 1,
        }),
        { limit, cursorOf: (row) => idSchema('delivery').parse(row.id) },
      );
      const rows = page.items.map((row) => ({ id: idSchema('delivery').parse(row.id), state: deliveryStateSchema.parse(row.state), shipId: idSchema('ship').nullable().parse(row.recipientShipId ?? row.claimedByShipId) }));
      const [events, party] = await Promise.all([
        db.event.findMany({
          where: { fleetId, deliveryId: { in: rows.map((row) => row.id) }, type: { in: [...DELIVERY_HISTORY_TYPES] } },
          orderBy: { seq: 'desc' },
        }),
        partiesOf(db, { fleetId, shipIds: rows.flatMap((row) => (row.shipId === null ? [] : [row.shipId])) }),
      ]);
      const steps = events.map(toSequencedEvent);
      return {
        items: rows.map((row) => ({
          id: row.id,
          ship: row.shipId === null ? null : party(row.shipId),
          state: row.state,
          steps: steps.flatMap(({ deliveryId, type, occurredAt, details }) =>
            deliveryId === row.id && isDeliveryChangeType(type) ? [{ type, occurredAt, isAgain: details.again === true, isOnceMore: details.onceMore === true }] : [],
          ),
        })),
        nextCursor: page.nextCursor,
      };
    },

    messageParties: async (fleetId, messageIds) => {
      const rows = await db.delivery.findMany({
        where: { fleetId, messageId: { in: [...messageIds] } },
        select: { messageId: true, recipientShipId: true, recipientType: true, claimedByShipId: true, message: { select: { senderShipId: true } } },
      });
      return new Map(
        rows.map((row) => [
          idSchema('message').parse(row.messageId),
          {
            senderId: idSchema('ship').parse(row.message.senderShipId),
            recipient: row.recipientShipId === null ? { kind: 'type', type: z.string().parse(row.recipientType) } : { kind: 'ship', shipId: idSchema('ship').parse(row.recipientShipId) },
            claimedBy: row.claimedByShipId === null ? null : idSchema('ship').parse(row.claimedByShipId),
          },
        ]),
      );
    },

    openInboxCount: (fleetId, { shipId, senderIds }) =>
      db.delivery.count({
        where: {
          fleetId,
          recipientShipId: shipId,
          state: { in: DELIVERY_STATES.filter((state) => isKeptBy('open', state)) },
          ...(senderIds === undefined ? {} : { message: { senderShipId: { in: [...senderIds] } } }),
        },
      }),

    inbox: async (fleetId, { shipId, filter, cursor, limit }) => {
      const page = pageOf(
        await db.delivery.findMany({
          where: {
            fleetId,
            recipientShipId: shipId,
            state: { in: DELIVERY_STATES.filter((state) => isKeptBy(filter, state)) },
            ...(cursor === undefined ? {} : { id: { lt: cursor } }),
          },
          select: INBOX_ROW,
          orderBy: { id: 'desc' },
          take: limit + 1,
        }),
        { limit, cursorOf: (row) => idSchema('delivery').parse(row.id) },
      );
      return { items: await inboxEntriesOf(db, { fleetId, shipId, rows: page.items }), nextCursor: page.nextCursor };
    },

    inboxMessage: async (fleetId, { shipId, deliveryId }) => {
      const row = await db.delivery.findFirst({ where: { fleetId, id: deliveryId, recipientShipId: shipId }, select: INBOX_ROW });
      return row ? (await inboxEntriesOf(db, { fleetId, shipId, rows: [row] }))[0] : undefined;
    },

    inboxWithdrawals: async (fleetId, { shipId, questionId, cursor, limit }) => {
      const ids = z.array(z.object({ id: idSchema('delivery') })).parse(await db.$queryRaw(inboxWithdrawalsStatement(fleetId, { shipId, questionId, cursor, limit })));
      const page = pageOf(ids, { limit, cursorOf: (row) => row.id });
      const rows = await db.delivery.findMany({ where: { fleetId, id: { in: page.items.map((row) => row.id) } }, select: INBOX_ROW, orderBy: { id: 'asc' } });
      // The index finds candidates; the payload parsed decides.
      const entries = await inboxEntriesOf(db, { fleetId, shipId, rows: rows.filter((row) => withdrawalOf(row.message)?.questionId === questionId) });
      return { items: entries, nextCursor: page.nextCursor };
    },

    needsAttention: async (fleetId, { shipId, state, cursor, limit }) => {
      // Ordered by since when, each delivery's last DeliveryUndeliverable or
      // DeliveryNotHandled, whose place in the stream also places the cursor:
      // a cursor dismissed meanwhile keeps its event. A delivery the fleet
      // never listed starts no page: nothing comes after it.
      const after =
        cursor === undefined
          ? null
          : ((
              await db.event.findFirst({
                where: { fleetId, deliveryId: cursor, type: { in: ['DeliveryUndeliverable', 'DeliveryNotHandled'] } },
                orderBy: { seq: 'desc' },
                select: { seq: true },
              })
            )?.seq ?? null);
      if (cursor !== undefined && after === null) {
        return { items: [], nextCursor: null };
      }
      const pageIds = z.array(z.object({ id: idSchema('delivery') })).parse(
        await db.$queryRaw`
          SELECT d.id FROM deliveries d
          CROSS JOIN LATERAL (
            SELECT e.seq, e.ship_id FROM events e
            WHERE e.fleet_id = d.fleet_id AND e.delivery_id = d.id AND e.type IN ('DeliveryUndeliverable', 'DeliveryNotHandled')
            ORDER BY e.seq DESC LIMIT 1) since
          WHERE d.fleet_id = ${fleetId} AND d.state IN ('undeliverable', 'notHandled')
            AND (${state ?? null}::text IS NULL OR d.state::text = ${state ?? null})
            AND (${shipId ?? null}::text IS NULL OR since.ship_id = ${shipId ?? null})
            AND (${after}::bigint IS NULL OR since.seq > ${after})
          ORDER BY since.seq
          LIMIT ${limit + 1}`,
      );
      const page = pageOf(pageIds, { limit, cursorOf: (row) => row.id });
      const rows = await db.delivery.findMany({
        where: { fleetId, id: { in: page.items.map((row) => row.id) } },
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
      const labelTexts = await labelTextsOf(db, { fleetId, messages: found.map(({ message }) => message) });
      const items = found
        .sort((first, second) => first.event.seq - second.event.seq)
        .map(({ deliveryId, state, attempts, isPushed, message, event, shipId: sinceShipId }) => ({
          deliveryId,
          state,
          attempts,
          isPushed,
          since: event.occurredAt,
          reason: typeof event.details.reason === 'string' ? event.details.reason : null,
          ship: party(sinceShipId),
          message: {
            id: message.id,
            sender: party(message.senderShipId),
            recipient: recipientOf(message.selector, { party, labelTexts }),
            inReplyTo: message.inReplyToMessageId,
            sentAt: message.createdAt,
            contentType: message.contentType,
            model: message.model,
            payload: message.payload,
          },
        }));
      return { items, nextCursor: page.nextCursor };
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
  waker: leaseWakerSchema.nullable(),
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
             l.pushed_at IS NOT NULL AS "isPushed", l.waker::text AS waker, l.ended_at IS NOT NULL AS "isEnded",
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
        waker: row.waker,
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
