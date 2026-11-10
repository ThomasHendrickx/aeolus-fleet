import { idSchema } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, prismaPoolOf, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPersonReadUnitOfWork } from '../src/adapters/prisma/person-read-unit-of-work.js';
import { ok } from '../src/domain/shared/result.js';
import { createEmptyDatabase } from '../src/testing/database.js';

const fleetId = idSchema('fleet').parse('flt_00000000000000000000000001');
let prisma: PrismaClient;
beforeAll(async () => {
  prisma = createPrismaClient(await createEmptyDatabase());
  await prisma.$executeRaw`CREATE TABLE snapshot_probe (fleet_id text PRIMARY KEY, value integer NOT NULL)`;
  await prisma.$executeRaw`INSERT INTO snapshot_probe VALUES (${fleetId}, 1)`;
});
afterAll(async () => { await prisma.$disconnect(); });

function readUnit() {
  return createPrismaPersonReadUnitOfWork({ prisma, portsOf: (connection) => connection });
}

async function locksOf(pid: number) {
  return prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_locks WHERE pid = ${pid} AND locktype = 'advisory'`;
}

describe('person read snapshot and shared settings lock', () => {
  it('takes its snapshot after an earlier settings writer commits, then keeps one consistent snapshot', async () => {
    // Given an exclusive settings writer with an uncommitted change.
    const writer = await prismaPoolOf(prisma).pool.connect();
    await writer.query('BEGIN');
    await writer.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext('network-settings'))", [fleetId]);
    await writer.query('UPDATE snapshot_probe SET value = 2 WHERE fleet_id = $1', [fleetId]);
    const pending = readUnit().run(fleetId, async (connection) => {
      const first = await connection.query<{ value: number }>('SELECT value FROM snapshot_probe WHERE fleet_id = $1', [fleetId]);
      await prisma.$executeRaw`UPDATE snapshot_probe SET value = 3 WHERE fleet_id = ${fleetId}`;
      const second = await connection.query<{ value: number }>('SELECT value FROM snapshot_probe WHERE fleet_id = $1', [fleetId]);
      return ok([first.rows, second.rows]);
    });
    try {
      await expect.poll(async () => {
        const rows = await prisma.$queryRaw<{ isWaiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND classid = hashtext(${fleetId})::oid AND objid = hashtext('network-settings')::oid) AS "isWaiting"`;
        return rows[0]?.isWaiting;
      }).toBe(true);

      // When the writer commits and the read finally obtains its shared lock.
      await writer.query('COMMIT');
      const result = await pending;

      // Then both reads see the committed writer, but neither sees the later change.
      expect(result).toEqual(ok([[{ value: 2 }], [{ value: 2 }]]));
    } finally {
      await writer.query('ROLLBACK');
      writer.release();
    }
  });

  it('rolls a failed query back and releases the session lock before returning its connection', async () => {
    // Given a read that fails after taking the shared session lock.
    let pid = 0;
    const pending = readUnit().run(fleetId, async (connection) => {
      const rows = await connection.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      pid = rows.rows[0]?.pid ?? 0;
      await connection.query('SELECT 1 / 0');
      return ok(undefined);
    });

    // When the transaction fails.
    await expect(pending).rejects.toMatchObject({ code: '22012' });

    // Then its backend holds no lock and subsequent reads still succeed.
    expect(await locksOf(pid)).toEqual([{ count: 0 }]);
    expect(await readUnit().run(fleetId, async (connection) => {
      const rows = await connection.query<{ value: number }>('SELECT 1 AS value');
      return ok(rows.rows);
    })).toEqual(ok([{ value: 1 }]));
  });

  it('cleans up a cancelled read without retaining its advisory lock', async () => {
    // Given a query executing on a locked read connection.
    let pid = 0;
    const pending = readUnit().run(fleetId, async (connection) => {
      const rows = await connection.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      pid = rows.rows[0]?.pid ?? 0;
      await connection.query('SELECT pg_sleep(30)');
      return ok(undefined);
    });
    // Attach the rejection handler before cancellation, so no rejection is unhandled.
    const rejected = expect(pending).rejects.toMatchObject({ code: '57014' });
    await expect.poll(async () => {
      const rows = await prisma.$queryRaw<{ isSleeping: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = ${pid} AND wait_event = 'PgSleep') AS "isSleeping"`;
      return rows[0]?.isSleeping;
    }).toBe(true);

    // When PostgreSQL cancels it.
    await prisma.$queryRaw`SELECT pg_cancel_backend(${pid})`;
    await rejected;

    // Then its failed transaction and session lock have both ended.
    expect(await locksOf(pid)).toEqual([{ count: 0 }]);
  });

  it('shuts down the shared pool even when only a raw snapshot read used the client', async () => {
    // Given a client whose Prisma query engine has never made a query.
    const raw = createPrismaClient(await createEmptyDatabase());
    const { pool } = prismaPoolOf(raw);
    try {
      const unit = createPrismaPersonReadUnitOfWork({ prisma: raw, portsOf: (connection) => connection });
      await unit.run(fleetId, async (connection) => {
        await connection.query('SELECT 1');
        return ok(undefined);
      });

      // When core shuts down through its existing client lifecycle.
      await raw.$disconnect();

      // Then no separate read pool remains alive.
      expect(pool.ended).toBe(true);
    } finally {
      if (!pool.ended) {
        await pool.end();
      }
    }
  });

  it('discards a broken connection when cleanup cannot establish that its lock was released', async () => {
    // Given a read whose backend disappears while holding the session lock.
    let pid = 0;
    const pending = readUnit().run(fleetId, async (connection) => {
      const rows = await connection.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      pid = rows.rows[0]?.pid ?? 0;
      await connection.query('SELECT pg_terminate_backend(pg_backend_pid())');
      return ok(undefined);
    });

    // When both the query and cleanup lose their backend.
    await expect(pending).rejects.toBeInstanceOf(Error);
    expect(pid).toBeGreaterThan(0);

    // Then the backend holds no lock and a later read uses a working connection.
    expect(await locksOf(pid)).toEqual([{ count: 0 }]);
    const next = await readUnit().run(fleetId, async (connection) => {
      const rows = await connection.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      return ok(rows.rows[0]?.pid);
    });
    expect(next.isOk && next.value !== undefined && next.value !== pid).toBe(true);
  });

});
