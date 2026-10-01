import {
  deliveryStateSchema,
  eventTypeSchema,
  idSchema,
  locationKindSchema,
  scopeSchema,
  shipKindSchema,
} from '@aeolus-fleet/common';
import { z } from 'zod';

import type { ConsoleSession } from '../../core/identity/console-session.js';
import type { AuthenticatedCrew, AuthenticatedShip, CrewTokenLease } from '../../core/identity/ports.js';
import type { Credential } from '../../core/identity/credential.js';
import type { OperatorAccount } from '../../core/identity/operator-account.js';
import type { Delivery, Message } from '../../core/messaging/message.js';
import type { FleetEventNotice, SequencedEvent } from '../../core/shared/events.js';
import type { DeliveryNotice } from '../../core/shared/notifier.js';
import type { Fleet } from '../../core/registry/fleet.js';
import type { Lease } from '../../core/registry/lease.js';
import type { ShipFacts } from '../../core/registry/ports.js';
import type { Ship } from '../../core/registry/ship.js';
import type { Caller } from '../../core/shared/caller.js';
import type { Recipient } from '../../core/shared/selector.js';

// Maps database rows to domain objects. A row is outside data: each one is
// parsed with the common schemas, so an id, kind or scope the domain does not
// know fails loudly here instead of travelling on under a type it does not have.
// Raw SQL returns snake_case columns; Prisma's own queries return camelCase.

const fleetRow = z.object({ id: idSchema('fleet'), name: z.string(), createdAt: z.date() });

export function toFleet(row: unknown): Fleet {
  return fleetRow.parse(row);
}

const shipRow = z.object({
  id: idSchema('ship'),
  fleetId: idSchema('fleet'),
  name: z.string(),
  type: z.string(),
  kind: shipKindSchema,
  scopes: z.array(scopeSchema),
  note: z.string().nullable(),
  createdAt: z.date(),
  retiredAt: z.date().nullable(),
});

export function toShip(row: unknown): Ship {
  return shipRow.parse(row);
}

const shipSqlRow = z
  .object({
    id: idSchema('ship'),
    fleet_id: idSchema('fleet'),
    name: z.string(),
    type: z.string(),
    kind: shipKindSchema,
    scopes: z.array(scopeSchema),
    note: z.string().nullable(),
    created_at: z.date(),
    retired_at: z.date().nullable(),
  })
  .transform(
    (row): Ship => ({
      id: row.id,
      fleetId: row.fleet_id,
      name: row.name,
      type: row.type,
      kind: row.kind,
      scopes: row.scopes,
      note: row.note,
      createdAt: row.created_at,
      retiredAt: row.retired_at,
    }),
  );

/** A ship as raw SQL returns it, in snake_case. */
export function toShipFromSql(row: unknown): Ship {
  return shipSqlRow.parse(row);
}

const shipFactsSqlRow = z.object({
  lease_location: locationKindSchema.nullable(),
  lease_location_description: z.string().nullable(),
  lease_started_at: z.date().nullable(),
  secret_issued_at: z.date().nullable(),
  secret_claimed_at: z.date().nullable(),
});

/** A ship with its open lease's location and its valid secret's dates, as the fleet listing reads it. */
export function toShipFacts(row: unknown): ShipFacts {
  const { lease_location, lease_location_description, lease_started_at, secret_issued_at, secret_claimed_at } =
    shipFactsSqlRow.parse(row);
  return {
    ship: toShipFromSql(row),
    openLease:
      lease_location && lease_started_at
        ? { location: { kind: lease_location, description: lease_location_description }, startedAt: lease_started_at }
        : null,
    validSecret: secret_issued_at && { issuedAt: secret_issued_at, claimedAt: secret_claimed_at },
  };
}

const leaseSqlRow = z
  .object({
    id: idSchema('lease'),
    fleet_id: idSchema('fleet'),
    ship_id: idSchema('ship'),
    location: locationKindSchema,
    location_description: z.string().nullable(),
    crew_token_hash: z.string().nullable(),
    started_at: z.date(),
    ended_at: z.date().nullable(),
  })
  .transform(
    (row): Lease => ({
      id: row.id,
      fleetId: row.fleet_id,
      shipId: row.ship_id,
      location: { kind: row.location, description: row.location_description },
      crewTokenHash: row.crew_token_hash,
      startedAt: row.started_at,
      endedAt: row.ended_at,
    }),
  );

export function toLease(row: unknown): Lease {
  return leaseSqlRow.parse(row);
}

const credentialSqlRow = z
  .object({
    id: idSchema('credential'),
    fleet_id: idSchema('fleet'),
    ship_id: idSchema('ship'),
    secret_hash: z.string(),
    issued_at: z.date(),
    claimed_at: z.date().nullable(),
    invalidated_at: z.date().nullable(),
  })
  .transform(
    (row): Credential => ({
      id: row.id,
      fleetId: row.fleet_id,
      shipId: row.ship_id,
      secretHash: row.secret_hash,
      issuedAt: row.issued_at,
      claimedAt: row.claimed_at,
      invalidatedAt: row.invalidated_at,
    }),
  );

export function toCredential(row: unknown): Credential {
  return credentialSqlRow.parse(row);
}

const operatorAccountSqlRow = z
  .object({
    id: idSchema('operator'),
    fleet_id: idSchema('fleet'),
    email: z.string(),
    password_hash: z.string(),
    created_at: z.date(),
  })
  .transform(
    (row): OperatorAccount => ({
      id: row.id,
      fleetId: row.fleet_id,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
    }),
  );

export function toOperatorAccount(row: unknown): OperatorAccount {
  return operatorAccountSqlRow.parse(row);
}

const consoleSessionSqlRow = z
  .object({
    id: idSchema('consoleSession'),
    fleet_id: idSchema('fleet'),
    ship_id: idSchema('ship'),
    lease_id: idSchema('lease'),
    token_hash: z.string(),
    created_at: z.date(),
    last_used_at: z.date(),
    expires_at: z.date(),
    ended_at: z.date().nullable(),
    end_reason: z.enum(['takenOver', 'signedOut', 'passwordReset']).nullable(),
  })
  .transform(
    (row): ConsoleSession => ({
      id: row.id,
      fleetId: row.fleet_id,
      shipId: row.ship_id,
      leaseId: row.lease_id,
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
      endedAt: row.ended_at,
      endReason: row.end_reason,
    }),
  );

export function toConsoleSession(row: unknown): ConsoleSession {
  return consoleSessionSqlRow.parse(row);
}

/** The ship a secret or a session token resolves to. */
const callerSqlRow = z.object({
  ship_id: idSchema('ship'),
  fleet_id: idSchema('fleet'),
  kind: shipKindSchema,
  scopes: z.array(scopeSchema),
});

export function toAuthenticatedShip(row: unknown): AuthenticatedShip {
  const { ship_id, fleet_id, kind, scopes } = callerSqlRow.parse(row);
  return { shipId: ship_id, fleetId: fleet_id, kind, scopes };
}

const crewSqlRow = z.object({ lease_id: idSchema('lease') });

/** The crew of a crew token: its ship, and the lease the token belongs to. */
function toAuthenticatedCrew(row: unknown): AuthenticatedCrew {
  const { lease_id } = crewSqlRow.parse(row);
  return { ...toAuthenticatedShip(row), leaseId: lease_id };
}

const crewTokenLeaseSqlRow = z.object({ is_open: z.boolean() });

/** The lease a crew token belongs to: open, with its crew, or ended. */
export function toCrewTokenLease(row: unknown): CrewTokenLease {
  const { is_open } = crewTokenLeaseSqlRow.parse(row);
  return is_open ? { isOpen: true, crew: toAuthenticatedCrew(row) } : { isOpen: false };
}

const consoleSessionCallerSqlRow = z.object({ console_session_id: idSchema('consoleSession') });

/** The caller of a console session: its ship, and the session it came through. */
export function toConsoleSessionCaller(row: unknown): Caller {
  const { console_session_id } = consoleSessionCallerSqlRow.parse(row);
  return { ...toAuthenticatedShip(row), consoleSessionId: console_session_id };
}

const messageRow = z.object({
  id: idSchema('message'),
  fleetId: idSchema('fleet'),
  senderShipId: idSchema('ship'),
  payload: z.string(),
  contentType: z.string(),
  idempotencyKey: z.string(),
  requestHash: z.string(),
  inReplyToMessageId: idSchema('message').nullable(),
  resendOfMessageId: idSchema('message').nullable(),
  createdAt: z.date(),
});

/** The selector columns of a message: a ship's id for a ship selector, a type for a type selector. */
const selectorColumns = z.union([
  z
    .object({ selectorKind: z.literal('ship'), selectorShipId: idSchema('ship'), selectorType: z.null() })
    .transform((row): Recipient => ({ kind: 'ship', shipId: row.selectorShipId })),
  z
    .object({ selectorKind: z.literal('type'), selectorShipId: z.null(), selectorType: z.string() })
    .transform((row): Recipient => ({ kind: 'type', type: row.selectorType })),
]);

export function toMessage(row: unknown): Message {
  return { ...messageRow.parse(row), selector: selectorColumns.parse(row) };
}

const recipientSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ship'), shipId: idSchema('ship') }),
  z.object({ kind: z.literal('type'), type: z.string() }),
]);

const deliveryNoticeSchema = z.object({
  fleetId: idSchema('fleet'),
  deliveryId: idSchema('delivery'),
  recipient: recipientSchema,
});

/** A pending delivery's notice, as the payload of its NOTIFY carries it. */
export function toDeliveryNotice(payload: unknown): DeliveryNotice {
  return deliveryNoticeSchema.parse(payload);
}

const fleetEventNoticeSchema = z.object({ fleetId: idSchema('fleet'), seq: z.number().int().positive() });

export function toFleetEventNotice(payload: unknown): FleetEventNotice {
  return fleetEventNoticeSchema.parse(payload);
}

/** A sequence number as Postgres returns a bigint; well within a safe integer for any fleet. */
const seqSchema = z.bigint().transform(Number);

export function toLastEventSeq(row: unknown): number {
  return z.object({ last_event_seq: seqSchema }).parse(row).last_event_seq;
}

/** A delivery's recipient columns: a ship's id, or a type. */
const recipientSqlColumns = z.union([
  z
    .object({ recipient_ship_id: idSchema('ship'), recipient_type: z.null() })
    .transform((row): Recipient => ({ kind: 'ship', shipId: row.recipient_ship_id })),
  z
    .object({ recipient_ship_id: z.null(), recipient_type: z.string() })
    .transform((row): Recipient => ({ kind: 'type', type: row.recipient_type })),
]);

const deliverySqlRow = z.object({
  id: idSchema('delivery'),
  fleet_id: idSchema('fleet'),
  message_id: idSchema('message'),
  state: deliveryStateSchema,
  claimed_by_ship_id: idSchema('ship').nullable(),
  claimed_by_lease_id: idSchema('lease').nullable(),
  attempts: z.int().nonnegative(),
  created_at: z.date(),
});

/** A delivery as raw SQL returns it, in snake_case. */
export function toDeliveryFromSql(row: unknown): Delivery {
  const delivery = deliverySqlRow.parse(row);
  return {
    id: delivery.id,
    fleetId: delivery.fleet_id,
    messageId: delivery.message_id,
    recipient: recipientSqlColumns.parse(row),
    state: delivery.state,
    claimedByShipId: delivery.claimed_by_ship_id,
    claimedByLeaseId: delivery.claimed_by_lease_id,
    attempts: delivery.attempts,
    createdAt: delivery.created_at,
  };
}

const eventRowSchema = z.object({
  id: idSchema('event'),
  fleetId: idSchema('fleet'),
  type: eventTypeSchema,
  occurredAt: z.date(),
  actorShipId: idSchema('ship').nullable(),
  shipId: idSchema('ship').nullable(),
  messageId: idSchema('message').nullable(),
  deliveryId: idSchema('delivery').nullable(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  seq: seqSchema,
});

/** An event row as Prisma reads it; a missing subject stays absent, as the core wrote it. */
export function toSequencedEvent(row: unknown): SequencedEvent {
  const { actorShipId, shipId, messageId, deliveryId, ...event } = eventRowSchema.parse(row);
  return {
    ...event,
    actor: actorShipId === null ? { kind: 'system' } : { kind: 'ship', shipId: actorShipId },
    ...(shipId === null ? {} : { shipId }),
    ...(messageId === null ? {} : { messageId }),
    ...(deliveryId === null ? {} : { deliveryId }),
  };
}

const abandonedDeliverySqlRow = z.object({ id: idSchema('delivery'), message_id: idSchema('message'), created_at: z.date() });

/** A delivery a retire abandoned, as its UPDATE returns it. */
export function toAbandonedDelivery(row: unknown) {
  const { id, message_id, created_at } = abandonedDeliverySqlRow.parse(row);
  return { deliveryId: id, messageId: message_id, createdAt: created_at };
}
