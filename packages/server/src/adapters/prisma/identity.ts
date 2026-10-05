import type {
  CallerLookup,
  ConsoleSessionRepository,
  CredentialRepository,
  NoticeDismissals,
  OperatorAccountLookup,
  OperatorAccountRepository,
  SignInTicketRepository,
} from '../../core/identity/ports.js';
import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';
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

/** Sessions keep their idle limit in whole seconds. */
const MS_PER_SECOND = 1000;

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
        SELECT id, fleet_id, email, password_hash, theme::text AS theme, created_at FROM operators
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
    lockEmail: async (email) => {
      // A transaction-level advisory lock on the email across the installation,
      // released at commit or rollback, as the ship-name lock is per fleet.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('operator-email'), hashtext(${email}))`;
    },
    findByEmailForUpdate: async (email) => {
      // Not scoped by fleet: signing in names no fleet (ADR 0007).
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, email, password_hash, theme::text AS theme, created_at FROM operators
        WHERE email = ${email}
        FOR UPDATE`;
      return row ? toOperatorAccount(row) : undefined;
    },
    findForFleetForUpdate: async (fleetId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, email, password_hash, theme::text AS theme, created_at FROM operators
        WHERE fleet_id = ${fleetId}
        FOR UPDATE`;
      return row ? toOperatorAccount(row) : undefined;
    },
    changePassword: async ({ fleetId, operatorId, passwordHash }) => {
      await db.operator.updateMany({ where: { fleetId, id: operatorId }, data: { passwordHash } });
    },
    findForFleet: async (fleetId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, email, password_hash, theme::text AS theme, created_at FROM operators
        WHERE fleet_id = ${fleetId}`;
      return row ? toOperatorAccount(row) : undefined;
    },
    setTheme: async ({ fleetId, operatorId, theme }) => {
      await db.operator.updateMany({ where: { fleetId, id: operatorId }, data: { theme } });
    },
  };
}

export function createPrismaSignInTicketRepository(db: Db): SignInTicketRepository {
  return {
    create: async ({ as, ...ticket }) => {
      await db.signInTicket.create({ data: { ...ticket, signInAs: as } });
    },
    redeem: async (tokenHash, at) => {
      // One statement marks it used only while unused and unexpired: of redeems racing
      // for one ticket, the row lock lets exactly one see it so. Not scoped by fleet:
      // the ticket names it (ADR 0007).
      const rows = z.array(z.object({ fleet_id: idSchema('fleet'), sign_in_as: z.enum(['operator', 'viewer']) })).parse(
        await db.$queryRaw`
          UPDATE sign_in_tickets SET used_at = ${at}
          WHERE token_hash = ${tokenHash} AND used_at IS NULL AND expires_at > ${at}
          RETURNING fleet_id, sign_in_as::text AS sign_in_as`,
      );
      const [redeemed] = rows;
      return redeemed && { fleetId: redeemed.fleet_id, as: redeemed.sign_in_as };
    },
  };
}

export function createPrismaConsoleSessionRepository(db: Db): ConsoleSessionRepository {
  return {
    create: async ({ idleLimitMs, ...session }) => {
      await db.consoleSession.create({ data: { ...session, idleLimitSeconds: Math.round(idleLimitMs / MS_PER_SECOND) } });
    },
    find: async (fleetId, consoleSessionId) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id, ship_id, lease_id, idle_limit_seconds, ends_by, device, token_hash, created_at, last_used_at, expires_at, ended_at,
          end_reason::text AS end_reason
        FROM console_sessions
        WHERE fleet_id = ${fleetId} AND id = ${consoleSessionId}`;
      return row ? toConsoleSession(row) : undefined;
    },
    end: async ({ fleetId, consoleSessionId, at, reason }) => {
      const [row] = await db.$queryRaw<unknown[]>`
        UPDATE console_sessions SET ended_at = ${at}, end_reason = ${reason}::console_session_end_reason
        WHERE fleet_id = ${fleetId} AND id = ${consoleSessionId} AND ended_at IS NULL
        RETURNING id, fleet_id, ship_id, lease_id, idle_limit_seconds, ends_by, device, token_hash, created_at, last_used_at, expires_at, ended_at,
          end_reason::text AS end_reason`;
      return row ? toConsoleSession(row) : undefined;
    },
    endAll: async ({ fleetId, shipId }, { at, reason }) => {
      const rows = await db.$queryRaw<unknown[]>`
        UPDATE console_sessions SET ended_at = ${at}, end_reason = ${reason}::console_session_end_reason
        WHERE fleet_id = ${fleetId} AND ship_id = ${shipId} AND ended_at IS NULL
        RETURNING id, fleet_id, ship_id, lease_id, idle_limit_seconds, ends_by, device, token_hash, created_at, last_used_at, expires_at, ended_at,
          end_reason::text AS end_reason`;
      return rows.map(toConsoleSession);
    },
  };
}

export function createPrismaCallerLookup(db: Db): CallerLookup {
  return {
    byCrewTokenHash: async (crewTokenHash, { at }) => {
      // One statement marks an open lease seen and reads it back. GREATEST
      // keeps two overlapping calls from moving it back.
      const [row] = await db.$queryRaw<unknown[]>`
        WITH seen AS (
          UPDATE leases SET last_seen_at = GREATEST(COALESCE(last_seen_at, ${at}), ${at})
          WHERE crew_token_hash = ${crewTokenHash} AND ended_at IS NULL
        )
        SELECT s.id AS ship_id, s.fleet_id, s.kind::text AS kind, s.scopes, l.id AS lease_id,
          l.ended_at IS NULL AS is_open
        FROM leases l
        JOIN ships s ON s.fleet_id = l.fleet_id AND s.id = l.ship_id
        WHERE l.crew_token_hash = ${crewTokenHash} AND s.retired_at IS NULL`;
      return row ? toCrewTokenLease(row) : undefined;
    },
    useConsoleSession: async ({ tokenHash, now }) => {
      // One statement checks the session, moves its expiry to its idle limit
      // after now, never past the moment it ends by, marks argo's lease seen
      // and returns the ship. GREATEST keeps two overlapping requests from
      // moving any date back.
      const [row] = await db.$queryRaw<unknown[]>`
        WITH used AS (
          UPDATE console_sessions cs
          SET last_used_at = GREATEST(cs.last_used_at, ${now}),
            expires_at = GREATEST(
              cs.expires_at,
              LEAST(${now}::timestamptz + make_interval(secs => cs.idle_limit_seconds), COALESCE(cs.ends_by, 'infinity'::timestamptz))
            )
          FROM ships s
          WHERE cs.token_hash = ${tokenHash} AND cs.ended_at IS NULL AND cs.expires_at > ${now}
            AND s.fleet_id = cs.fleet_id AND s.id = cs.ship_id
          RETURNING cs.id AS console_session_id, cs.lease_id, cs.expires_at, s.id AS ship_id, s.fleet_id, s.kind::text AS kind, s.scopes
        ), seen AS (
          UPDATE leases l SET last_seen_at = GREATEST(COALESCE(l.last_seen_at, ${now}), ${now})
          FROM used WHERE l.id = used.lease_id AND l.ended_at IS NULL
        )
        SELECT * FROM used`;
      return row ? toConsoleSessionCaller(row) : undefined;
    },
    consoleSessionEnding: async (tokenHash) => {
      const session = await db.consoleSession.findUnique({ where: { tokenHash }, select: { endReason: true } });
      return session?.endReason ?? undefined;
    },
  };
}

export function createPrismaNoticeDismissals(db: Db): NoticeDismissals {
  return {
    dismissed: async ({ fleetId, consoleSessionId }) =>
      (await db.noticeDismissal.findMany({ where: { fleetId, consoleSessionId }, select: { noticeId: true } })).map(({ noticeId }) => noticeId),
    dismiss: async ({ fleetId, consoleSessionId, noticeId, at }) => {
      await db.noticeDismissal.createMany({ data: [{ fleetId, consoleSessionId, noticeId, dismissedAt: at }], skipDuplicates: true });
    },
  };
}
