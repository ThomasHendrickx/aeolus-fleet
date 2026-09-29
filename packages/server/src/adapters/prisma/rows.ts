import { idSchema, locationKindSchema, scopeSchema, shipKindSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { ConsoleSession } from '../../core/identity/console-session.js';
import type { AuthenticatedShip } from '../../core/identity/ports.js';
import type { Credential } from '../../core/identity/credential.js';
import type { Fleet } from '../../core/registry/fleet.js';
import type { Lease } from '../../core/registry/lease.js';
import type { Ship } from '../../core/registry/ship.js';
import type { Caller } from '../../core/shared/caller.js';

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

const leaseSqlRow = z
  .object({
    id: idSchema('lease'),
    fleet_id: idSchema('fleet'),
    ship_id: idSchema('ship'),
    location: locationKindSchema,
    location_description: z.string().nullable(),
    started_at: z.date(),
    ended_at: z.date().nullable(),
  })
  .transform(
    (row): Lease => ({
      id: row.id,
      fleetId: row.fleet_id,
      shipId: row.ship_id,
      location: { kind: row.location, description: row.location_description },
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

const consoleSessionCallerSqlRow = z.object({ console_session_id: idSchema('consoleSession') });

/** The caller of a console session: its ship, and the session it came through. */
export function toConsoleSessionCaller(row: unknown): Caller {
  const { console_session_id } = consoleSessionCallerSqlRow.parse(row);
  return { ...toAuthenticatedShip(row), consoleSessionId: console_session_id };
}
