import { z } from 'zod';

import type { Db } from './client.js';
import { LISTENER_APPLICATION_NAME } from './delivery-notices.js';

const connectedRowSchema = z.object({ connected: z.boolean() });

/**
 * Whether a core process is connected to this database now: every running
 * core holds its delivery listener's connection, named by its
 * `application_name`. A command that must run with core stopped, such as
 * `fleet:restored`, asks first.
 */
export async function isCoreConnected(db: Db): Promise<boolean> {
  const [row] = await db.$queryRaw<unknown[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = ${LISTENER_APPLICATION_NAME}
    ) AS connected`;
  return connectedRowSchema.parse(row).connected;
}
