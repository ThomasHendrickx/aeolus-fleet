/** Indexed source-envelope and crew reads for the synchronous journey projection. */
import { idSchema, shipKindSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { qualifyJourneyMessage } from '../../domain/messaging/public.js';
import type { JourneyFact } from '../../domain/shared/fleet-journey.js';
import type { FleetEvent } from '../../domain/shared/events.js';
import type { Db } from './client.js';

const partyRow = z.object({ id: idSchema('ship'), kind: shipKindSchema, isCrewed: z.boolean() });

async function party(db: Db, input: { event: FleetEvent; shipId: string }) {
  const [row] = z.array(partyRow).parse(await db.$queryRaw`
    SELECT s.id, s.kind, EXISTS (
      SELECT 1 FROM (
        SELECT l.ended_at FROM leases l WHERE l.fleet_id = s.fleet_id AND l.ship_id = s.id
          AND l.started_at <= ${input.event.occurredAt}
        ORDER BY l.started_at DESC, l.id DESC LIMIT 1
      ) latest WHERE latest.ended_at IS NULL OR latest.ended_at > ${input.event.occurredAt}
    ) AS "isCrewed" FROM ships s WHERE s.fleet_id = ${input.event.fleetId} AND s.id = ${input.shipId}`);
  return row;
}

const sourceRow = z.object({
  fleetId: idSchema('fleet'), deliveryId: idSchema('delivery'), senderShipId: idSchema('ship'), recipientShipId: idSchema('ship'),
  senderKind: shipKindSchema, recipientKind: shipKindSchema, senderCrewed: z.boolean(), recipientCrewed: z.boolean(),
  contentType: z.string(), createdAt: z.date(), isCustomerSend: z.boolean(), isReturnToSender: z.boolean(),
});

/** All recipients of a source batch share one indexed metadata read and one metadata write. */
export async function journeySourceFacts(db: Db, events: readonly FleetEvent[]): Promise<JourneyFact[]> {
  const facts: JourneyFact[] = [];
  for (const event of events.filter((event) => event.type === 'ShipClaimed' && event.shipId)) {
    const ship = await party(db, { event, shipId: event.shipId ?? '' });
    if (ship) facts.push({ kind: 'crewed', at: event.occurredAt.toISOString(), shipId: ship.id, shipKind: ship.kind });
  }
  const sources = events.flatMap((event, position) =>
    ['MessageAccepted', 'DeliveryReceived', 'DeliveryHanded'].includes(event.type) && event.messageId && event.deliveryId && event.shipId
      ? [{ fleetId: event.fleetId, messageId: event.messageId, deliveryId: event.deliveryId, shipId: event.shipId, position }] : []);
  if (sources.length === 0) return facts;
  const rows = z.array(sourceRow).parse(await db.$queryRaw`
    SELECT m.fleet_id AS "fleetId", d.id AS "deliveryId", s.id AS "senderShipId", r.id AS "recipientShipId",
      s.kind AS "senderKind", r.kind AS "recipientKind", m.content_type AS "contentType", m.created_at AS "createdAt",
      EXISTS (SELECT 1 FROM (
        SELECT l.ended_at FROM leases l WHERE l.fleet_id = s.fleet_id AND l.ship_id = s.id AND l.started_at <= m.created_at
        ORDER BY l.started_at DESC, l.id DESC LIMIT 1
      ) latest WHERE latest.ended_at IS NULL OR latest.ended_at > m.created_at) AS "senderCrewed",
      EXISTS (SELECT 1 FROM (
        SELECT l.ended_at FROM leases l WHERE l.fleet_id = r.fleet_id AND l.ship_id = r.id AND l.started_at <= m.created_at
        ORDER BY l.started_at DESC, l.id DESC LIMIT 1
      ) latest WHERE latest.ended_at IS NULL OR latest.ended_at > m.created_at) AS "recipientCrewed",
      EXISTS (SELECT 1 FROM events e WHERE e.fleet_id = m.fleet_id AND e.message_id = m.id AND e.type = 'MessageAccepted'
        AND e.actor_kind = 'ship' AND e.actor_ship_id = m.sender_ship_id) AS "isCustomerSend",
      EXISTS (SELECT 1 FROM messages original JOIN deliveries accepted ON accepted.fleet_id = original.fleet_id AND accepted.message_id = original.id
        WHERE original.fleet_id = m.fleet_id AND original.id = m.in_reply_to_message_id AND original.sender_ship_id = r.id
          AND COALESCE(accepted.recipient_ship_id, accepted.claimed_by_ship_id) = s.id
          AND accepted.journey_qualifying = true AND accepted.journey_both_crewed = true) AS "isReturnToSender"
    FROM jsonb_to_recordset(${JSON.stringify(sources)}::jsonb) AS source("fleetId" text, "messageId" text, "deliveryId" text, "shipId" text, position integer)
    JOIN messages m ON m.fleet_id = source."fleetId" AND m.id = source."messageId"
    JOIN deliveries d ON d.fleet_id = m.fleet_id AND d.id = source."deliveryId" AND d.message_id = m.id
    JOIN ships s ON s.fleet_id = m.fleet_id AND s.id = m.sender_ship_id
    JOIN ships r ON r.fleet_id = m.fleet_id AND r.id = source."shipId"
    WHERE d.journey_qualifying IS NULL AND m.resend_of_message_id IS NULL
    ORDER BY source.position`);
  const qualified = rows.map((row) => ({ ...row, ...qualifyJourneyMessage({
    sender: { id: row.senderShipId, kind: row.senderKind, isCrewed: row.senderCrewed },
    recipient: { id: row.recipientShipId, kind: row.recipientKind, isCrewed: row.recipientCrewed },
    contentType: row.contentType, isSystem: !row.isCustomerSend, isReturnToSender: row.isReturnToSender,
  }) }));
  if (qualified.length > 0) {
    const metadata = qualified.map((row) => ({ fleetId: row.fleetId, deliveryId: row.deliveryId, isQualifying: row.isQualifying, isCrewedAtBothEnds: row.isCrewedAtBothEnds }));
    await db.$executeRaw`UPDATE deliveries d SET journey_qualifying = source."isQualifying", journey_both_crewed = source."isCrewedAtBothEnds"
      FROM jsonb_to_recordset(${JSON.stringify(metadata)}::jsonb) AS source("fleetId" text, "deliveryId" text, "isQualifying" boolean, "isCrewedAtBothEnds" boolean)
      WHERE d.fleet_id = source."fleetId" AND d.id = source."deliveryId"`;
  }
  return [...facts, ...qualified.map((row) => ({ kind: 'message' as const, at: row.createdAt.toISOString(), isQualifying: row.isQualifying, isRoundTrip: row.isRoundTrip }))];
}

/** A single source uses the same bounded batch path as a fan-out send. */
export async function journeySourceFact(db: Db, event: FleetEvent): Promise<JourneyFact | undefined> {
  return (await journeySourceFacts(db, [event]))[0];
}
