import type {
  CallerLookup,
  ConsoleSessionRepository,
  CredentialRepository,
  OperatorAccountLookup,
  OperatorAccountRepository,
} from '../../core/identity/ports.js';
import type { Db } from './client.js';
import {
  toCrewTokenLease,
  toConsoleSession,
  toConsoleSessionCaller,
  toCredential,
  toOperatorAccount,
} from './rows.js';

// Lock order, as the CredentialRepository port states: the ship when a use case
// locks it, then a credential or the operator account, then console sessions,
// then leases. Sign-in, sign-out, claims, starting prompts and resetting the
// password all follow it, so they serialise instead of deadlocking.

export function createPrismaCredentialRepository(db: Db): CredentialRepository {
  return {
    create: async (credential) => {
      await db.credential.create({ data: credential });
    },
    findValidBySecretHashForUpdate: async (secretHash) => {
      // Not scoped by fleet: a secret carries no fleet (ADR 0007). Locking the
      // credential row makes a concurrent replacement either wait for this
      // transaction, or invalidate the row first: read committed then checks
      // the row again once the lock is free, and finds it no longer valid.
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, ship_id, secret_hash, issued_at, claimed_at, invalidated_at
        FROM credentials
        WHERE secret_hash = ${secretHash} AND invalidated_at IS NULL
        FOR UPDATE`;
      return row ? toCredential(row) : undefined;
    },
    findValidForShipForUpdate: async (fleetId, shipId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, ship_id, secret_hash, issued_at, claimed_at, invalidated_at
        FROM credentials
        WHERE fleet_id = ${fleetId} AND ship_id = ${shipId} AND invalidated_at IS NULL
        FOR UPDATE`;
      return row ? toCredential(row) : undefined;
    },
    markClaimed: async ({ fleetId, credentialId, at }) => {
      await db.credential.updateMany({ where: { fleetId, id: credentialId, claimedAt: null }, data: { claimedAt: at } });
    },
    invalidate: async ({ fleetId, credentialId, at }) => {
      await db.credential.updateMany({
        where: { fleetId, id: credentialId, invalidatedAt: null },
        data: { invalidatedAt: at },
      });
    },
  };
}

export function createPrismaOperatorAccountLookup(db: Db): OperatorAccountLookup {
  return {
    byEmail: async (email) => {
      // Not scoped by fleet: signing in names no fleet (ADR 0007). No lock:
      // a plain read never waits for a sign-in or a reset holding the row.
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, email, password_hash, created_at FROM operators
        WHERE email = ${email}`;
      return row ? toOperatorAccount(row) : undefined;
    },
  };
}

export function createPrismaOperatorAccountRepository(db: Db): OperatorAccountRepository {
  return {
    create: async (account) => {
      await db.operator.create({ data: account });
    },
    findByEmailForUpdate: async (email) => {
      // Not scoped by fleet: signing in names no fleet (ADR 0007).
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, email, password_hash, created_at FROM operators
        WHERE email = ${email}
        FOR UPDATE`;
      return row ? toOperatorAccount(row) : undefined;
    },
    findForFleetForUpdate: async (fleetId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, email, password_hash, created_at FROM operators
        WHERE fleet_id = ${fleetId}
        FOR UPDATE`;
      return row ? toOperatorAccount(row) : undefined;
    },
    changePassword: async ({ fleetId, operatorId, passwordHash }) => {
      await db.operator.updateMany({ where: { fleetId, id: operatorId }, data: { passwordHash } });
    },
  };
}

export function createPrismaConsoleSessionRepository(db: Db): ConsoleSessionRepository {
  return {
    create: async (session) => {
      await db.consoleSession.create({ data: session });
    },
    end: async ({ fleetId, consoleSessionId, at }) => {
      const [row] = await db.$queryRaw<unknown[]>`
        UPDATE console_sessions SET ended_at = ${at}
        WHERE fleet_id = ${fleetId} AND id = ${consoleSessionId} AND ended_at IS NULL
        RETURNING id, fleet_id, ship_id, lease_id, token_hash, created_at, last_used_at, expires_at, ended_at`;
      return row ? toConsoleSession(row) : undefined;
    },
    endAll: async (fleetId, at) => {
      const rows = await db.$queryRaw<unknown[]>`
        UPDATE console_sessions SET ended_at = ${at}
        WHERE fleet_id = ${fleetId} AND ended_at IS NULL
        RETURNING id, fleet_id, ship_id, lease_id, token_hash, created_at, last_used_at, expires_at, ended_at`;
      return rows.map(toConsoleSession);
    },
  };
}

export function createPrismaCallerLookup(db: Db): CallerLookup {
  return {
    byCrewTokenHash: async (crewTokenHash) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT s.id AS ship_id, s.fleet_id, s.kind::text AS kind, s.scopes, l.id AS lease_id,
          l.ended_at IS NULL AS is_open
        FROM leases l
        JOIN ships s ON s.fleet_id = l.fleet_id AND s.id = l.ship_id
        WHERE l.crew_token_hash = ${crewTokenHash} AND s.retired_at IS NULL`;
      return row ? toCrewTokenLease(row) : undefined;
    },
    useConsoleSession: async ({ tokenHash, now, expiresAt }) => {
      // One statement checks the session, moves its expiry and returns the ship.
      // GREATEST keeps two overlapping requests from moving either date back.
      const [row] = await db.$queryRaw<unknown[]>`
        UPDATE console_sessions cs
        SET last_used_at = GREATEST(cs.last_used_at, ${now}), expires_at = GREATEST(cs.expires_at, ${expiresAt})
        FROM ships s
        WHERE cs.token_hash = ${tokenHash} AND cs.ended_at IS NULL AND cs.expires_at > ${now}
          AND s.fleet_id = cs.fleet_id AND s.id = cs.ship_id
        RETURNING cs.id AS console_session_id, s.id AS ship_id, s.fleet_id, s.kind::text AS kind, s.scopes`;
      return row ? toConsoleSessionCaller(row) : undefined;
    },
  };
}
