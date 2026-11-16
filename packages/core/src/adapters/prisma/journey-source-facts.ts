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

const envelopeRow = z.object({ senderShipId: idSchema('ship'), contentType: z.string(), inReplyTo: idSchema('message').nullable(), resendOf: idSchema('message').nullable(), createdAt: z.date(), isCustomerSend: z.boolean(), isProjected: z.boolean() });

/** Every referenced row is looked up by fleet and id; no payload column is selected. */
export async function journeySourceFact(db: Db, event: FleetEvent): Promise<JourneyFact | undefined> {
  const at = event.occurredAt.toISOString();
  if (event.type === 'ShipClaimed' && event.shipId) {
    const ship = await party(db, { event, shipId: event.shipId });
    return ship ? { kind: 'crewed', at, shipId: ship.id, shipKind: ship.kind } : undefined;
  }
  if (!['MessageAccepted', 'DeliveryReceived', 'DeliveryHanded'].includes(event.type) || !event.messageId || !event.deliveryId || !event.shipId) return undefined;
  const [envelope] = z.array(envelopeRow).parse(await db.$queryRaw`
    SELECT m.sender_ship_id AS "senderShipId", m.content_type AS "contentType", m.in_reply_to_message_id AS "inReplyTo", m.resend_of_message_id AS "resendOf", m.created_at AS "createdAt",
      EXISTS (SELECT 1 FROM deliveries d WHERE d.fleet_id = m.fleet_id AND d.id = ${event.deliveryId} AND d.journey_qualifying IS NOT NULL) AS "isProjected",
      EXISTS (SELECT 1 FROM events e WHERE e.fleet_id = m.fleet_id AND e.message_id = m.id AND e.type = 'MessageAccepted'
        AND e.actor_kind = 'ship' AND e.actor_ship_id = m.sender_ship_id) AS "isCustomerSend"
    FROM messages m WHERE m.fleet_id = ${event.fleetId} AND m.id = ${event.messageId}`);
  if (envelope?.resendOf !== null || envelope.isProjected) return undefined;
  const accepted = { ...event, occurredAt: envelope.createdAt };
  const [sender, recipient] = await Promise.all([
    party(db, { event: accepted, shipId: envelope.senderShipId }), party(db, { event: accepted, shipId: event.shipId }),
  ]);
  if (!sender || !recipient) return undefined;
  const [original] = z.array(z.object({ isReturnToSender: z.boolean() })).parse(await db.$queryRaw`
    SELECT EXISTS (
      SELECT 1 FROM messages m JOIN deliveries d ON d.fleet_id = m.fleet_id AND d.message_id = m.id
      WHERE m.fleet_id = ${event.fleetId} AND m.id = ${envelope.inReplyTo}
        AND m.sender_ship_id = ${recipient.id} AND COALESCE(d.recipient_ship_id, d.claimed_by_ship_id) = ${sender.id}
        AND d.journey_qualifying = true AND d.journey_both_crewed = true
    ) AS "isReturnToSender"`);
  const qualified = qualifyJourneyMessage({ sender, recipient, contentType: envelope.contentType,
    isSystem: !envelope.isCustomerSend,
    isReturnToSender: original?.isReturnToSender ?? false,
  });
  await db.$executeRaw`UPDATE deliveries SET journey_qualifying = ${qualified.isQualifying}, journey_both_crewed = ${qualified.isCrewedAtBothEnds}
    WHERE fleet_id = ${event.fleetId} AND id = ${event.deliveryId}`;
  return { kind: 'message', at: envelope.createdAt.toISOString(), isQualifying: qualified.isQualifying, isRoundTrip: qualified.isRoundTrip };
}
