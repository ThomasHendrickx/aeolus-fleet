/**
 * A session lock precedes BEGIN, so waiting for a settings writer cannot freeze
 * an earlier snapshot. Cleanup never returns a possibly locked connection.
 */
import type { PoolClient } from 'pg';

import type { PersonReadUnitOfWork } from '../../domain/registry/person-read-unit-of-work.js';
import { prismaPoolOf, TRANSACTION_TIME_MS, type PrismaClient } from './client.js';

export function createPrismaPersonReadUnitOfWork<Tx>(options: { prisma: PrismaClient; portsOf: (connection: PoolClient) => Tx }): PersonReadUnitOfWork<Tx> {
  const { pool, onStatement } = prismaPoolOf(options.prisma);
  return {
    run: async (fleetId, work) => {
      // Establish Prisma's ownership of shutdown even when its first use is this raw read.
      await options.prisma.$connect();
      const connection = await pool.connect();
      let hasAttemptedLock = false;
      let hasConnectionFailed = false;
      const onConnectionError = () => { hasConnectionFailed = true; };
      // pg also reports broken sockets as events while a client is checked out.
      connection.on('error', onConnectionError);
      const query = async (statement: string, values: readonly unknown[] = []) => {
        onStatement?.(statement);
        await connection.query(statement, [...values]);
      };
      try {
        await query("SELECT set_config('statement_timeout', $1, false)", [String(TRANSACTION_TIME_MS)]);
        hasAttemptedLock = true;
        await query("SELECT pg_advisory_lock_shared(hashtext($1), hashtext('network-settings'))", [fleetId]);
        await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result = await work(options.portsOf(connection));
        await query(result.isOk ? 'COMMIT' : 'ROLLBACK');
        return result;
      } finally {
        let isSafeToReuse = false;
        try {
          // ROLLBACK is safe even if BEGIN/COMMIT lost its reply or never completed.
          await query('ROLLBACK');
          if (hasAttemptedLock) {
            await query("SELECT pg_advisory_unlock_shared(hashtext($1), hashtext('network-settings'))", [fleetId]);
          }
          await query('RESET statement_timeout');
          isSafeToReuse = true;
        } finally {
          try {
            connection.release(!isSafeToReuse || hasConnectionFailed);
          } finally {
            connection.removeListener('error', onConnectionError);
          }
        }
      }
    },
  };
}
